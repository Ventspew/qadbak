FROM python:3.12-alpine
WORKDIR /app
COPY app.py /app/app.py
ENV PYTHONUNBUFFERED=1
EXPOSE 8787
CMD ["python", "-u", "/app/app.py"]
