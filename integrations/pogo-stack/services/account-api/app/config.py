from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = Field(default="mysql+pymysql://pogo:pogo@mariadb:3306/pogo", alias="DATABASE_URL")
    api_key: str = Field(default="dev-api-key", alias="API_KEY")

    model_config = {"env_file": ".env", "extra": "ignore", "populate_by_name": True}


settings = Settings()
