package main

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type clientConfigResponse struct {
	DefaultSyncDomain   string `json:"defaultSyncDomain"`
	LockSyncDomain      bool   `json:"lockSyncDomain"`
	HideSyncDomainInput bool   `json:"hideSyncDomainInput"`
	RequireActivation   bool   `json:"requireActivation"`
	SetupRequired       bool   `json:"setupRequired"`
}

func (a *app) handleClientConfig(c *gin.Context) {
	settings, err := a.readAdminSettings(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"message": "读取客户端策略失败，请稍后重试。",
		})
		return
	}

	defaultSyncDomain := strings.TrimSpace(settings[settingClientDefaultSyncDomain])
	lockSyncDomain := parseBoolString(settings[settingClientSyncDomainLocked], false)
	hideSyncDomainInput := parseBoolString(settings[settingClientHideSyncDomainEdit], false)

	c.JSON(http.StatusOK, clientConfigResponse{
		DefaultSyncDomain:   defaultSyncDomain,
		LockSyncDomain:      lockSyncDomain,
		HideSyncDomainInput: hideSyncDomainInput,
		RequireActivation:   true,
		SetupRequired:       !a.isSetupComplete(),
	})
}
