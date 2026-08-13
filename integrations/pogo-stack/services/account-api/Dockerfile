FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY schema.sql ./schema.sql

ENV DATABASE_URL=mysql+pymysql://pogo:pogo@mariadb:3306/pogo
ENV API_KEY=dev-api-key

EXPOSE 4242

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4242"]
