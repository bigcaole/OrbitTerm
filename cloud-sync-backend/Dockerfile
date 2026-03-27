FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /orbit-sync-server ./cmd/server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata
RUN addgroup -S orbitterm && adduser -S orbitterm -G orbitterm

ENV TZ=UTC
WORKDIR /srv

COPY --from=builder /orbit-sync-server /usr/local/bin/orbit-sync-server

EXPOSE 8080
USER orbitterm
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["orbit-sync-server"]
