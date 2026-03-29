package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"database/sql"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	totpDigits       = 6
	totpPeriodSecond = 30
	totpIssuer       = "OrbitTerm"
	backupCodeCount  = 8
)

type totpValidationResult struct {
	Valid  bool
	Offset int64
}

func generateTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	encoder := base32.StdEncoding.WithPadding(base32.NoPadding)
	return encoder.EncodeToString(buf), nil
}

func buildTOTPURI(account string, secret string) string {
	normalizedAccount := strings.TrimSpace(strings.ToLower(account))
	if normalizedAccount == "" {
		normalizedAccount = "user"
	}
	label := url.PathEscape(fmt.Sprintf("%s:%s", totpIssuer, normalizedAccount))
	query := url.Values{}
	query.Set("secret", secret)
	query.Set("issuer", totpIssuer)
	query.Set("algorithm", "SHA1")
	query.Set("digits", fmt.Sprintf("%d", totpDigits))
	query.Set("period", fmt.Sprintf("%d", totpPeriodSecond))
	return "otpauth://totp/" + label + "?" + query.Encode()
}

func normalizeOTPCode(raw string) string {
	code := strings.TrimSpace(raw)
	code = strings.ReplaceAll(code, " ", "")
	code = strings.ReplaceAll(code, "-", "")
	return code
}

func validateTOTP(secret string, otpCode string, now time.Time) (totpValidationResult, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return totpValidationResult{}, errors.New("empty secret")
	}
	code := normalizeOTPCode(otpCode)
	if len(code) != totpDigits {
		return totpValidationResult{Valid: false}, nil
	}
	for i := 0; i < len(code); i++ {
		if code[i] < '0' || code[i] > '9' {
			return totpValidationResult{Valid: false}, nil
		}
	}

	counter := now.UTC().Unix() / int64(totpPeriodSecond)
	for _, offset := range []int64{-1, 0, 1} {
		expected, genErr := generateTOTPCode(secret, counter+offset)
		if genErr != nil {
			return totpValidationResult{}, genErr
		}
		if expected == code {
			return totpValidationResult{Valid: true, Offset: offset}, nil
		}
	}
	return totpValidationResult{Valid: false}, nil
}

func generateTOTPCode(secret string, counter int64) (string, error) {
	if counter < 0 {
		return "", errors.New("invalid counter")
	}
	encoder := base32.StdEncoding.WithPadding(base32.NoPadding)
	secretBytes, err := encoder.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", err
	}

	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(counter))

	mac := hmac.New(sha1.New, secretBytes)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	binaryCode := (int(sum[offset])&0x7f)<<24 |
		(int(sum[offset+1])&0xff)<<16 |
		(int(sum[offset+2])&0xff)<<8 |
		(int(sum[offset+3]) & 0xff)
	mod := 1
	for i := 0; i < totpDigits; i++ {
		mod *= 10
	}
	value := binaryCode % mod
	return fmt.Sprintf("%0*d", totpDigits, value), nil
}

func generateBackupCodes() ([]string, []string, error) {
	plain := make([]string, 0, backupCodeCount)
	hashes := make([]string, 0, backupCodeCount)
	for i := 0; i < backupCodeCount; i++ {
		var raw [4]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return nil, nil, err
		}
		token := strings.ToUpper(hex.EncodeToString(raw[:]))
		code := fmt.Sprintf("%s-%s", token[:4], token[4:])
		hashBytes, hashErr := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if hashErr != nil {
			return nil, nil, hashErr
		}
		plain = append(plain, code)
		hashes = append(hashes, string(hashBytes))
	}
	return plain, hashes, nil
}

func normalizeBackupCode(raw string) string {
	code := strings.TrimSpace(strings.ToUpper(raw))
	code = strings.ReplaceAll(code, " ", "")
	code = strings.ReplaceAll(code, "_", "")
	if len(code) == 8 && !strings.Contains(code, "-") {
		return code[:4] + "-" + code[4:]
	}
	return code
}

func verifyAndConsumeBackupCode(hashes []string, rawCode string) (matched bool, nextHashes []string) {
	normalized := normalizeBackupCode(rawCode)
	if normalized == "" {
		return false, hashes
	}
	next := make([]string, 0, len(hashes))
	consumed := false
	for _, hash := range hashes {
		if !consumed && bcrypt.CompareHashAndPassword([]byte(hash), []byte(normalized)) == nil {
			consumed = true
			continue
		}
		next = append(next, hash)
	}
	return consumed, next
}

func nullIfEmptyString(value string) sql.NullString {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{Valid: true, String: trimmed}
}
