export type BuiltinSnippetCategory = 'ubuntu' | 'debian' | 'alpine' | 'huawei';

export interface BuiltinSnippetTemplate {
  id: string;
  category: BuiltinSnippetCategory;
  title: string;
  command: string;
  tags: string[];
  description: string;
}

export const builtinSnippetCategoryLabels: Record<BuiltinSnippetCategory, string> = {
  ubuntu: 'Ubuntu',
  debian: 'Debian',
  alpine: 'Alpine',
  huawei: '华为交换机/路由器'
};

export const builtinSnippetTemplates: BuiltinSnippetTemplate[] = [
  {
    id: 'builtin-ubuntu-apt-upgrade',
    category: 'ubuntu',
    title: '系统更新（APT）',
    command: 'sudo apt update && sudo apt upgrade -y',
    tags: ['系统维护', '更新'],
    description: '刷新软件源并升级已安装包，适合日常巡检前执行。'
  },
  {
    id: 'builtin-ubuntu-service-status',
    category: 'ubuntu',
    title: '检查服务状态',
    command: 'sudo systemctl status <service-name> --no-pager',
    tags: ['systemd', '排障'],
    description: '快速确认服务是否运行，替换 <service-name> 后使用。'
  },
  {
    id: 'builtin-ubuntu-service-log',
    category: 'ubuntu',
    title: '实时查看服务日志',
    command: 'sudo journalctl -u <service-name> -f --no-pager',
    tags: ['日志', 'systemd'],
    description: '持续追踪服务日志，适合定位启动失败或异常重启。'
  },
  {
    id: 'builtin-ubuntu-port-check',
    category: 'ubuntu',
    title: '端口监听检查',
    command: 'sudo ss -tulpn',
    tags: ['网络', '端口'],
    description: '查看监听端口与对应进程，判断服务是否正确绑定。'
  },
  {
    id: 'builtin-debian-install-tools',
    category: 'debian',
    title: '安装常用工具',
    command: 'sudo apt update && sudo apt install -y curl wget vim git net-tools',
    tags: ['初始化', '工具'],
    description: '新机初始化常用运维工具，便于后续排障与维护。'
  },
  {
    id: 'builtin-debian-package-check',
    category: 'debian',
    title: '检查软件包是否安装',
    command: "dpkg -l | grep -i '<package-name>'",
    tags: ['软件包', '排障'],
    description: '核对软件包安装状态，替换 <package-name>。'
  },
  {
    id: 'builtin-debian-syslog-tail',
    category: 'debian',
    title: '查看系统日志尾部',
    command: 'sudo tail -n 200 /var/log/syslog',
    tags: ['日志', '系统'],
    description: '快速回看系统最近日志，适合故障初步排查。'
  },
  {
    id: 'builtin-debian-time-sync',
    category: 'debian',
    title: '检查时钟同步状态',
    command: 'timedatectl status',
    tags: ['时间', 'NTP'],
    description: '核对系统时区和 NTP 同步状态，避免证书与鉴权异常。'
  },
  {
    id: 'builtin-alpine-update',
    category: 'alpine',
    title: '系统更新（APK）',
    command: 'sudo apk update && sudo apk upgrade',
    tags: ['系统维护', '更新'],
    description: 'Alpine 标准升级流程，常用于容器或轻量主机维护。'
  },
  {
    id: 'builtin-alpine-install-tools',
    category: 'alpine',
    title: '安装基础工具',
    command: 'sudo apk add --no-cache curl bash bind-tools iproute2',
    tags: ['初始化', '工具'],
    description: '补齐基础运维工具，适合最小化 Alpine 环境。'
  },
  {
    id: 'builtin-alpine-service-status',
    category: 'alpine',
    title: 'OpenRC 服务状态',
    command: 'sudo rc-service <service-name> status',
    tags: ['OpenRC', '排障'],
    description: '查看 OpenRC 服务状态，替换 <service-name> 后执行。'
  },
  {
    id: 'builtin-alpine-runlevel-services',
    category: 'alpine',
    title: '查看开机服务列表',
    command: 'sudo rc-update show',
    tags: ['OpenRC', '开机启动'],
    description: '列出当前 runlevel 的服务挂载情况。'
  },
  {
    id: 'builtin-huawei-version',
    category: 'huawei',
    title: '查看设备版本',
    command: 'display version',
    tags: ['设备信息', '巡检'],
    description: '确认设备型号、版本和运行时长，是巡检基础命令。'
  },
  {
    id: 'builtin-huawei-interface-brief',
    category: 'huawei',
    title: '查看接口概要',
    command: 'display interface brief',
    tags: ['接口', '链路'],
    description: '快速检查端口 up/down 状态与流量统计。'
  },
  {
    id: 'builtin-huawei-routing',
    category: 'huawei',
    title: '查看路由表',
    command: 'display ip routing-table',
    tags: ['路由', '网络'],
    description: '检查路由学习情况，定位可达性问题。'
  },
  {
    id: 'builtin-huawei-current-config',
    category: 'huawei',
    title: '查看当前配置',
    command: 'display current-configuration',
    tags: ['配置', '审计'],
    description: '查看设备当前运行配置，建议配合关键字过滤。'
  },
  {
    id: 'builtin-huawei-save-config',
    category: 'huawei',
    title: '保存当前配置',
    command: 'save',
    tags: ['配置', '持久化'],
    description: '将当前运行配置写入启动配置，执行前建议确认变更。'
  }
];
