FROM python:3.12-slim-bookworm
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY app.py /app/app.py
ENV PYTHONUNBUFFERED=1
EXPOSE 8787
CMD ["python", "-u", "/app/app.py"]
