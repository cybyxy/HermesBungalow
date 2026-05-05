#!/usr/bin/env python3
"""
任务台账管理脚本
用法:
  python task_manager.py list                    # 列出所有任务
  python task_manager.py create "标题" "描述"    # 创建任务
  python task_manager.py update T-005 step 2 "🔄 进行中"  # 更新步骤状态
  python task_manager.py status T-005 "✅ done" # 更新任务状态
  python task_manager.py close T-005 "完成"     # 关闭任务
"""

import sys
import re
import uuid
from datetime import datetime
from pathlib import Path

TRACKER_PATH = Path(__file__).parent.parent / "docs" / "task-tracker.md"
TEAM_MEMBERS = {
    "崽崽": "城主",
    "马斯特": "后端核心",
    "陆向宇": "前端架构",
    "林见溪": "UI设计",
    "顾言卿": "需求分析",
    "沈枢衡": "技术架构",
    "江定策": "系统策略",
    "秦鉴微": "质量保障",
    "苏砚书": "技术文档",
    "费斯特": "快速API",
}


def read_tracker():
    return TRACKER_PATH.read_text()


def write_tracker(content):
    TRACKER_PATH.write_text(content)


def get_next_id(content):
    ids = re.findall(r'T-(\d+)', content)
    if not ids:
        return "T-001"
    return f"T-{int(max(ids)) + 1:03d}"


def list_tasks(content):
    # 提取当前进行中和待安排的任务
    print("\n📋 任务台账概览\n")

    # 简单解析任务
    tasks = []
    task_pattern = re.compile(r'\|\s*(T-\d+)\s*\|\s*([^\|]+?)\s*\|\s*([^\|]+?)\s*\|\s*([^\|]+?)\s*\|\s*([^\|]+?)\s*\|')
    for match in task_pattern.finditer(content):
        tid, title, status, priority, assignee = match.groups()
        tasks.append((tid.strip(), title.strip(), status.strip(), priority.strip(), assignee.strip()))

    # 分类显示
    active = [t for t in tasks if '🔄' in t[2]]
    pending = [t for t in tasks if '⏳' in t[2]]
    done = [t for t in tasks if '✅' in t[2]]

    print(f"🔄 进行中 ({len(active)}个)")
    for t in active:
        print(f"  {t[0]} [{t[3]}] {t[1]} - {t[4]}")

    print(f"\n⏳ 待开始 ({len(pending)}个)")
    for t in pending:
        print(f"  {t[0]} [{t[3]}] {t[1]} - {t[4]}")

    print(f"\n✅ 已完成 ({len(done)}个)")
    for t in done:
        print(f"  {t[0]} [{t[3]}] {t[1]} - {t[4]}")


def create_task(title, description, priority="P2", assignee="崽崽", estimated_hours=1):
    content = read_tracker()
    task_id = get_next_id(content)
    task_uuid = str(uuid.uuid4())[:8]
    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")

    # 按预计工时分配每步计划时间
    # 需求确认: 10%, 编码实现: 70%, 交付物汇报: 20%
    h1 = round(estimated_hours * 0.10, 1)
    h2 = round(estimated_hours * 0.70, 1)
    h3 = round(estimated_hours * 0.20, 1)
    d1 = today
    d2 = today + __import__('datetime').timedelta(days=max(1, round(estimated_hours / 4)))
    d3 = d2 + __import__('datetime').timedelta(days=max(1, round(estimated_hours / 2)))

    new_task = f"""

### {task_id} · {title}

**任务描述**：{description}

**完成日期**：{today_str}
**预计工时**：{estimated_hours}h

**任务总体：**

| ID | Title | Status | Priority | Assignee | Updated |
|----|-------|--------|----------|----------|---------|
| {task_id} | {title} | ⏳ pending | {priority} | @{assignee} | {today_str} |

**时间线（规划）：**

| # | 步骤 | 计划开始 | 计划结束 | 预计工时 | 状态 |
|---|------|----------|----------|----------|------|
| 1 | 需求确认 | {d1.strftime('%Y-%m-%d')} | {d1.strftime('%Y-%m-%d')} | {h1}h | ⏳ pending |
| 2 | 编码实现 | {(d1.__class__(year=d1.year, month=d1.month, day=d1.day) + __import__('datetime').timedelta(days=1)).strftime('%Y-%m-%d')} | {d2.strftime('%Y-%m-%d')} | {h2}h | ⏳ pending |
| 3 | 交付物汇报 | {d3.strftime('%Y-%m-%d')} | {d3.strftime('%Y-%m-%d')} | {h3}h | ⏳ pending |

**执行步骤：**

| # | 步骤 | 状态 | 执行人 | 阻塞项 |
|---|------|------|--------|--------|
| 1 | 需求确认 | ⏳ pending | @{assignee} | — |
| 2 | 编码实现 | ⏳ pending | @{assignee} | — |
| 3 | 交付物汇报 | ⏳ pending | @{assignee} | — |

**任务风险：**

| # | 风险描述 | 影响 | 概率 | 应对措施 | 状态 |
|---|----------|------|------|----------|------|

"""
    # 插入到"当前进行中"之前
    marker = "## 当前进行中"
    if marker in content:
        content = content.replace(marker, new_task + "\n" + marker)
    else:
        # 插入到项目阶段进度之后
        content = content + "\n" + new_task

    write_tracker(content)
    print(f"✅ 任务已创建: {task_id} - {title}")
    return task_id


def update_step(task_id, step_num, new_status):
    content = read_tracker()
    # 找到任务段落
    pattern = rf'### {task_id}.*?(?=### |\Z)'
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        print(f"❌ 未找到任务 {task_id}")
        return

    task_section = match.group()

    # 更新步骤状态
    # 匹配步骤行 | 1 | 步骤名 | 状态 |
    step_pattern = rf'(\| {step_num} \|.*?\|\s*)(\S+)(\s*\|)'
    new_step_line = rf'\g<1>{new_status}\g<3>'

    new_section = re.sub(step_pattern, new_step_line, task_section)

    # 如果步骤状态变为非pending，同时更新任务总体状态
    if new_status in ['🔄 进行中', '✅ 完成']:
        status_pattern = rf'(\| {task_id} \|.*?\|)\s*\S+\s*(\|.*?\|)\s*(\S+)(\s*\|)'
        display_status = '🔄 进行中' if new_status == '🔄 进行中' else '✅ done'
        new_section = re.sub(status_pattern, rf'\1 {display_status} \2 {new_status}\4', new_section)

    content = content.replace(task_section, new_section)
    write_tracker(content)
    print(f"✅ {task_id} 步骤{step_num}更新為: {new_status}")


def update_task_status(task_id, new_status):
    content = read_tracker()
    pattern = rf'(\| {task_id} \|.*?\|)\s*\S+\s*(\|.*?\|)\s*\S+\s*(\|)'
    new_line = rf'\1 {new_status} \2 {new_status} \3'
    content = re.sub(pattern, new_line, content)
    write_tracker(content)
    print(f"✅ {task_id} 状态更新為: {new_status}")


def close_task(task_id, reason=""):
    content = read_tracker()
    today = datetime.now().strftime("%Y-%m-%d")

    # 找到任务段落
    pattern = rf'### {task_id}.*?(?=### |\Z)'
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        print(f"❌ 未找到任务 {task_id}")
        return

    task_section = match.group()

    # 更新状态为done
    task_section = re.sub(
        rf'(\| {task_id} \|.*?\|)\s*🔄.*?( \|)',
        rf'\1 ✅ done \2',
        task_section
    )

    # 添加关闭原因到风险表
    if reason:
        risk_row = f"\n| — | {reason} | — | — | — | 已关闭 |"
        task_section = task_section.replace("| # | 风险描述 | 影响 | 概率 | 应对措施 | 状态 |", "| # | 风险描述 | 影响 | 概率 | 应对措施 | 状态 |\n| — | — | — | — | — | — |")
        task_section = re.sub(
            r'(\|# \| 风险描述 \| 影响 \| 概率 \| 应对措施 \| 状态 \|)',
            rf'\1\n| 1 | {reason} | — | — | 已关闭 | — | 🔵 已关闭 |'
        , task_section)

    content = content.replace(match.group(), task_section)

    # 移动到"已关闭"区域
    # 找到已完成任务段落
    completed_pattern = r'(## 已关闭\n\n\| ID \| Title \| 关闭时间 \| 备注 \|)'
    insert_pos = content.find("## 已关闭")
    if insert_pos == -1:
        # 没有已关闭区域，创建
        closed_section = "\n\n## 已关闭\n\n| ID | Title | 关闭时间 | 备注 |\n|----|-------|----------|------|\n"
        content = content + closed_section

    # 提取任务基本信息用于移动
    title_match = re.search(r'### ' + task_id + r' · ([^\n]+)', task_section)
    if title_match:
        title = title_match.group(1)
        closed_row = f"| {task_id} | {title} | {today} | {reason} |\n"

        # 从当前进行中移除（保留在原位置，只是改状态）
        # 添加到已关闭表格
        table_pattern = r'(## 已关闭\n\n\| ID \| Title \| 关闭时间 \| 备注 \|\n\|----\|-----\|'
        match_end = re.search(r'\|----\|-----\|----------\|------\|\n', content[content.find("## 已关闭"):])
        if match_end:
            pos = content.find("## 已关闭") + match_end.end()
            content = content[:pos] + closed_row + content[pos:]

    write_tracker(content)
    print(f"✅ 任务 {task_id} 已关闭，原因: {reason}")


if __name__ == "__main__":
    args = sys.argv[1:]

    if not args or args[0] == "list":
        list_tasks(read_tracker())

    elif args[0] == "create":
        if len(args) < 3:
            print("用法: task_manager.py create \"标题\" \"描述\" [优先级] [执行人]")
            sys.exit(1)
        title, desc = args[1], args[2]
        priority = args[3] if len(args) > 3 else "P2"
        assignee = args[4] if len(args) > 4 else "崽崽"
        create_task(title, desc, priority, assignee, int(args[5]) if len(args) > 5 else 1)

    elif args[0] == "update":
        # task_manager.py update T-005 step 2 "🔄 进行中"
        # task_manager.py update T-005 status "✅ done"
        if len(args) < 4:
            print("用法: task_manager.py update T-XXX step 步骤号 \"状态\"")
            sys.exit(1)
        task_id, target, value = args[1], args[2], args[3]
        if target == "step":
            update_step(task_id, int(args[3]), args[4])
        elif target == "status":
            update_task_status(task_id, args[3])

    elif args[0] == "close":
        if len(args) < 3:
            print("用法: task_manager.py close T-XXX \"关闭原因\"")
            sys.exit(1)
        close_task(args[1], args[2])

    else:
        print(__doc__)
