FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt && useradd -r -u 10001 app
COPY backend backend
COPY frontend frontend
COPY alembic alembic
COPY alembic.ini .
USER app
EXPOSE 8000 8501
