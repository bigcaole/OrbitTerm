use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use tauri::webview_version;
use tauri::AppHandle;
use tokio::fs;
use tokio::net::lookup_host;

use crate::models::{HealthCheckItem, HealthCheckResponse};

pub async fn run_health_check(app: &AppHandle) -> HealthCheckResponse {
    let mut items = Vec::with_capacity(3);
    items.push(check_network().await);
    items.push(check_app_data_writable(app).await);
    items.push(check_webview_runtime().await);

    HealthCheckResponse {
        generated_at: now_unix_ts(),
        items,
    }
}

async fn check_network() -> HealthCheckItem {
    match lookup_host(("api.openai.com", 443)).await {
        Ok(mut addrs) => {
            if addrs.next().is_some() {
                HealthCheckItem {
                    id: "network".to_string(),
                    label: "网络权限".to_string(),
                    status: "ok".to_string(),
                    message: "网络解析可用，已通过基础连通性检查。".to_string(),
                    suggestion: None,
                }
            } else {
                HealthCheckItem {
                    id: "network".to_string(),
                    label: "网络权限".to_string(),
                    status: "warn".to_string(),
                    message: "DNS 查询未返回可用地址。".to_string(),
                    suggestion: Some("请检查本机网络、代理或 DNS 配置。".to_string()),
                }
            }
        }
        Err(err) => HealthCheckItem {
            id: "network".to_string(),
            label: "网络权限".to_string(),
            status: "warn".to_string(),
            message: format!("网络检测失败：{err}"),
            suggestion: Some("请允许应用访问网络，并确认防火墙未拦截 OrbitTerm。".to_string()),
        },
    }
}

async fn check_app_data_writable(app: &AppHandle) -> HealthCheckItem {
    let Some(mut dir) = app.path_resolver().app_data_dir() else {
        return HealthCheckItem {
            id: "app_data".to_string(),
            label: "数据目录权限".to_string(),
            status: "warn".to_string(),
            message: "无法定位应用数据目录。".to_string(),
            suggestion: Some("请检查系统目录权限，或以当前用户重新安装应用。".to_string()),
        };
    };

    if let Err(err) = fs::create_dir_all(&dir).await {
        return HealthCheckItem {
            id: "app_data".to_string(),
            label: "数据目录权限".to_string(),
            status: "warn".to_string(),
            message: format!("创建应用数据目录失败：{err}"),
            suggestion: Some("请检查磁盘权限与可用空间。".to_string()),
        };
    }

    dir.push(".orbitterm-healthcheck.tmp");
    if let Err(err) = fs::write(&dir, b"orbitterm-healthcheck").await {
        return HealthCheckItem {
            id: "app_data".to_string(),
            label: "数据目录权限".to_string(),
            status: "warn".to_string(),
            message: format!("数据目录不可写：{err}"),
            suggestion: Some("请检查目录读写权限，避免将数据目录放在只读磁盘。".to_string()),
        };
    }

    let _ = fs::remove_file(&dir).await;
    HealthCheckItem {
        id: "app_data".to_string(),
        label: "数据目录权限".to_string(),
        status: "ok".to_string(),
        message: "应用数据目录读写正常。".to_string(),
        suggestion: None,
    }
}

#[cfg(windows)]
async fn check_webview_runtime() -> HealthCheckItem {
    let result = tokio::task::spawn_blocking(webview_version).await;
    match result {
        Ok(Ok(version)) => HealthCheckItem {
            id: "webview2".to_string(),
            label: "WebView2 Runtime".to_string(),
            status: "ok".to_string(),
            message: format!("已检测到 WebView2 Runtime：{version}"),
            suggestion: None,
        },
        Ok(Err(err)) => HealthCheckItem {
            id: "webview2".to_string(),
            label: "WebView2 Runtime".to_string(),
            status: "warn".to_string(),
            message: format!("未检测到可用的 WebView2 Runtime：{err}"),
            suggestion: Some(
                "请安装或修复 Microsoft Edge WebView2 Runtime（Evergreen），再重启 OrbitTerm。"
                    .to_string(),
            ),
        },
        Err(err) => HealthCheckItem {
            id: "webview2".to_string(),
            label: "WebView2 Runtime".to_string(),
            status: "warn".to_string(),
            message: format!("WebView2 检测任务失败：{err}"),
            suggestion: Some("请手动确认 WebView2 Runtime 是否安装。".to_string()),
        },
    }
}

#[cfg(target_os = "macos")]
async fn check_webview_runtime() -> HealthCheckItem {
    HealthCheckItem {
        id: "wkwebview".to_string(),
        label: "WKWebView Runtime".to_string(),
        status: "ok".to_string(),
        message: "系统自带 WKWebView，运行时检查通过。".to_string(),
        suggestion: None,
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
async fn check_webview_runtime() -> HealthCheckItem {
    HealthCheckItem {
        id: "webview_runtime".to_string(),
        label: "WebView Runtime".to_string(),
        status: "warn".to_string(),
        message: "当前平台依赖系统 WebView 运行时，建议确认版本满足 Tauri 要求。".to_string(),
        suggestion: Some("请安装并更新系统 WebKitGTK/WebKit 运行时。".to_string()),
    }
}

fn now_unix_ts() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as i64,
        Err(_) => 0,
    }
}
