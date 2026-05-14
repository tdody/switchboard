from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8765
    cors_origins: list[str] = ["http://localhost:5173"]
    pane_capture_lines: int = 200

    model_config = SettingsConfigDict(env_prefix="SWITCHBOARD_", env_file=".env")


settings = Settings()
