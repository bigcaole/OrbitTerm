package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const autoBackupFilePrefix = "orbitterm-backup-"

func (a *app) startAutoBackupWorker() {
	if !a.cfg.BackupAutoEnabled {
		return
	}
	outputDir := strings.TrimSpace(a.cfg.BackupOutputDir)
	if outputDir == "" {
		outputDir = "./data/exports"
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		log.Printf("[backup.auto] 初始化备份目录失败: dir=%s err=%v", outputDir, err)
		return
	}

	interval := time.Duration(a.cfg.BackupIntervalMin) * time.Minute
	retention := a.cfg.BackupRetention
	includeAudit := a.cfg.BackupIncludeAudit
	auditLimit := a.cfg.BackupAuditLimit
	if auditLimit <= 0 {
		auditLimit = 2000
	}
	log.Printf(
		"[backup.auto] 自动备份已启用: interval=%s retention=%d output=%s includeAudit=%v auditLimit=%d",
		interval.String(),
		retention,
		outputDir,
		includeAudit,
		auditLimit,
	)

	go func() {
		run := func() {
			if err := a.runAutoBackupOnce(outputDir, retention, includeAudit, auditLimit); err != nil {
				log.Printf("[backup.auto] 执行失败: %v", err)
				return
			}
		}

		time.Sleep(15 * time.Second)
		run()

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			run()
		}
	}()
}

func (a *app) runAutoBackupOnce(
	outputDir string,
	retention int,
	includeAudit bool,
	auditLimit int,
) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	payload, err := a.buildAdminBackupPayload(ctx, "system:auto-backup", includeAudit, auditLimit)
	if err != nil {
		return fmt.Errorf("build payload: %w", err)
	}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	sum := sha256.Sum256(raw)
	sumHex := hex.EncodeToString(sum[:])
	timestamp := time.Now().UTC().Format("20060102-150405Z")
	baseName := fmt.Sprintf("%s%s.json", autoBackupFilePrefix, timestamp)
	finalPath := filepath.Join(outputDir, baseName)
	tmpPath := finalPath + ".tmp"
	if err := os.WriteFile(tmpPath, raw, 0o600); err != nil {
		return fmt.Errorf("write tmp backup: %w", err)
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return fmt.Errorf("move backup file: %w", err)
	}

	checksumPath := finalPath + ".sha256"
	checksumLine := fmt.Sprintf("%s  %s\n", sumHex, baseName)
	if err := os.WriteFile(checksumPath, []byte(checksumLine), 0o600); err != nil {
		return fmt.Errorf("write checksum file: %w", err)
	}

	verifyRaw, err := os.ReadFile(finalPath)
	if err != nil {
		return fmt.Errorf("verify read backup: %w", err)
	}
	verifySum := sha256.Sum256(verifyRaw)
	verifyHex := hex.EncodeToString(verifySum[:])
	if !strings.EqualFold(sumHex, verifyHex) {
		return fmt.Errorf("checksum verify mismatch: expected=%s actual=%s", sumHex, verifyHex)
	}

	if err := cleanupAutoBackupFiles(outputDir, retention); err != nil {
		log.Printf("[backup.auto] 清理历史备份失败: %v", err)
	}

	log.Printf("[backup.auto] 备份完成: file=%s sha256=%s", finalPath, sumHex)
	return nil
}

func cleanupAutoBackupFiles(outputDir string, retention int) error {
	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return err
	}
	type backupItem struct {
		path    string
		modTime time.Time
	}
	backups := make([]backupItem, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if !strings.HasPrefix(name, autoBackupFilePrefix) || !strings.HasSuffix(name, ".json") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		backups = append(backups, backupItem{
			path:    filepath.Join(outputDir, name),
			modTime: info.ModTime(),
		})
	}
	if len(backups) <= retention {
		return nil
	}
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].modTime.After(backups[j].modTime)
	})
	for idx, item := range backups {
		if idx < retention {
			continue
		}
		_ = os.Remove(item.path)
		_ = os.Remove(item.path + ".sha256")
	}
	return nil
}
