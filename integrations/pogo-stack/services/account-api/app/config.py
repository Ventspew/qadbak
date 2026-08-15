from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = Field(default="mysql+pymysql://pogo:pogo@mariadb:3306/pogo", alias="DATABASE_URL")
    api_key: str = Field(default="dev-api-key", alias="API_KEY")
    dashboard_user: str = Field(default="admin", alias="DASHBOARD_USER")
    dashboard_password: str = Field(default="change-me-dashboard-password", alias="DASHBOARD_PASSWORD")
    session_days: int = Field(default=7, alias="DASHBOARD_SESSION_DAYS")
    rotom_url: str = Field(default="http://rotom:7072", alias="ROTOM_URL")
    rotom_secret: str = Field(default="", alias="ROTOM_SECRET")

    model_config = {"env_file": ".env", "extra": "ignore", "populate_by_name": True}


settings = Settings()
