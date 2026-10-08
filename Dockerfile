# One image: the API and the web app together (for platforms that run one container per app).
# Build from this directory:  docker build -t ghcr.io/<you>/astravel:1 .
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 STATIC_DIR=/srv/site
RUN useradd -r -u 10001 app
WORKDIR /srv
COPY api/requirements.txt .
RUN pip install -r requirements.txt
COPY api/app app
COPY web/site site
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-access-log"]
