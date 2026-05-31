"""Tests for `tmux.collect_state_singleflight` (THI-142).

The wrapper coalesces concurrent callers onto one underlying `collect_state`
execution so repeated /api/state polling under the modal-open cadence
(THI-105) can't pile up parallel tmux subprocess spawns and trip
`OSError: [Errno 24] Too many open files`.

Tests patch the module-level `collect_state` on a copy of `tmux` so we
exercise the coalescing logic without touching a real tmux server.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from switchboard.schemas import StateResponse
from switchboard.services import tmux


def _empty_state() -> StateResponse:
    """A cheap valid StateResponse for tests that just need an object."""
    return StateResponse(sessions=[], windows=[], server_running=True)


@pytest.fixture(autouse=True)
def _reset_inflight() -> None:
    """Make sure each test starts from a clean module-level slot — relevant
    when a prior test raises mid-leader and the cleanup path doesn't run."""
    with tmux._inflight_lock:
        tmux._inflight = None
    yield
    with tmux._inflight_lock:
        tmux._inflight = None


def test_two_concurrent_callers_share_one_collect_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """Coalescing: while one thread is running `collect_state`, a second
    caller doesn't kick off its own scan. Both return the same object and
    the underlying function is called exactly once."""
    call_count = 0
    leader_in_critical = threading.Event()
    release_leader = threading.Event()
    shared_state = _empty_state()

    def slow_collect_state() -> StateResponse:
        nonlocal call_count
        call_count += 1
        # Signal the test that the leader is mid-execution, then block
        # until the test releases us. Any followers arriving in this
        # window must coalesce, not spawn their own scan.
        leader_in_critical.set()
        release_leader.wait(timeout=2.0)
        return shared_state

    monkeypatch.setattr(tmux, "collect_state", slow_collect_state)

    with ThreadPoolExecutor(max_workers=2) as ex:
        leader_future = ex.submit(tmux.collect_state_singleflight)
        # Wait for the leader to be inside the critical section, then
        # submit the follower. This guarantees the ordering we want to
        # test (follower arrives while leader holds the slot).
        assert leader_in_critical.wait(timeout=2.0)
        follower_future = ex.submit(tmux.collect_state_singleflight)
        # Give the follower a moment to reach `existing.result()`.
        # Without this the leader could resolve before the follower
        # even checks the inflight slot, which still works but doesn't
        # exercise the path we're after.
        threading.Event().wait(0.05)
        release_leader.set()
        leader_result = leader_future.result(timeout=2.0)
        follower_result = follower_future.result(timeout=2.0)

    assert leader_result is shared_state
    assert follower_result is shared_state
    assert call_count == 1


def test_sequential_callers_each_call_collect_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """No caching across scans: a second call after the first finishes
    starts fresh, not from the same shared future."""
    call_count = 0

    def counted_collect_state() -> StateResponse:
        nonlocal call_count
        call_count += 1
        return _empty_state()

    monkeypatch.setattr(tmux, "collect_state", counted_collect_state)

    tmux.collect_state_singleflight()
    tmux.collect_state_singleflight()
    tmux.collect_state_singleflight()

    assert call_count == 3


def test_leader_exception_propagates_to_followers(monkeypatch: pytest.MonkeyPatch) -> None:
    """If the leader's `collect_state` raises, every follower waiting on
    the same future sees the same exception. Critical for failure modes
    like tmux server dying mid-scan — followers should know the scan
    failed instead of receiving a phantom success."""
    leader_in_critical = threading.Event()
    release_leader = threading.Event()
    boom = RuntimeError("tmux died")

    def raising_collect_state() -> StateResponse:
        leader_in_critical.set()
        release_leader.wait(timeout=2.0)
        raise boom

    monkeypatch.setattr(tmux, "collect_state", raising_collect_state)

    with ThreadPoolExecutor(max_workers=2) as ex:
        leader_future = ex.submit(tmux.collect_state_singleflight)
        assert leader_in_critical.wait(timeout=2.0)
        follower_future = ex.submit(tmux.collect_state_singleflight)
        threading.Event().wait(0.05)
        release_leader.set()

        with pytest.raises(RuntimeError, match="tmux died"):
            leader_future.result(timeout=2.0)
        with pytest.raises(RuntimeError, match="tmux died"):
            follower_future.result(timeout=2.0)


def test_inflight_slot_clears_after_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """Recovery: after a failed scan, the next caller must be able to
    start a fresh one. The `finally` block clears the in-flight slot
    even when the leader raised."""
    attempts = 0

    def flaky_collect_state() -> StateResponse:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("first attempt fails")
        return _empty_state()

    monkeypatch.setattr(tmux, "collect_state", flaky_collect_state)

    with pytest.raises(RuntimeError, match="first attempt fails"):
        tmux.collect_state_singleflight()

    # Slot must be clear so this call becomes a fresh leader.
    assert tmux._inflight is None
    state = tmux.collect_state_singleflight()
    assert state.server_running is True
    assert attempts == 2
