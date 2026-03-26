FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /orbit-sync-server ./cmd/server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

ENV TZ=UTC
WORKDIR /srv

COPY --from=builder /orbit-sync-server /usr/local/bin/orbit-sync-server

EXPOSE 8080

CMD ["orbit-sync-server"]
