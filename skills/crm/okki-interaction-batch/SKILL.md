---
name: "[Harvest-SubAgent] OKKI CRM 客户互动批量抓取"
description: 针对 OKKI CRM (xiaoman.cn) 客户详情页，通过 Console 脚本批量抓取最近 N 条混合类型互动（邮件、WhatsApp、订单状态等）。解决 API
  参数差异、分页截断及详情接口权限问题，适用于需要导出完整沟通历史的场景。
created_by: sub_agent
main_agent_spawn_note: This skill SKILL.md can be injected into a new sub-agent by passing it in sessions_spawn.required_skills.
sub_agent_type: browser
---
## Workflow
1. **定位客户详情页**
   - 确保浏览器位于 `https://crm.xiaoman.cn/crm/customer/list`。
   - 搜索并点击目标客户 `{customer_name}`，等待 URL 变为包含 `company_id={company_id}` 的详情页。
   - 验证页面加载完成，左侧菜单高亮显示“客户”。

2. **执行批量抓取脚本**
   - 在浏览器控制台执行专用 JS 脚本，自动处理多源数据合并：
     - **列表获取**：调用 `/api/customerRead/trailList`。注意：若返回数据不足，需尝试移除 `type` 参数或增加 `scene=drawer` 参数以获取 WhatsApp 聊天记录；分页时注意 `pageSize` 限制（通常 50-100）。
     - **详情补全**：遍历前 `{count}` 条记录。邮件类（`type='mail'` 或含 `direction`）调用 `/api/mailRead/info`；其他类型调用 `/api/customerRead/trailDetail`。
     - **异常处理**：若 WhatsApp 详情接口返回 403/Failed to fetch，保留基础元数据（时间、联系人、摘要），标记为“内容受限”。
   - 脚本输出标准 JSON 格式：`{total, results: [...]}`。

3. **保存与验证**
   - 将脚本输出的 JSON 保存为 `{filename}.json`。
   - 验证文件包含字段：`date`, `type` (邮件/WhatsApp/其他), `subject/title`, `body/content`。
   - 检查最新一条互动的时间是否在预期范围内。

## Suggestions
- **API 参数试探**：若默认 `trailList` 缺少 WhatsApp 数据，优先尝试添加 `scene=drawer` 参数，这是获取即时通讯记录的常见隐藏路径。
- **批量详情优化**：对于非邮件类互动，若 `trailDetail` 失败，可尝试 `/api/talkRead/history` 作为备选，但需注意权限隔离。
- **去重逻辑**：脚本内部应基于 `id` 去重，防止不同 API 源返回重复的动态条目。

## Fallback / Edge Cases
- **WhatsApp 内容缺失**：若 API 无法获取聊天正文，回退至 UI 自动化方案：在“历史动态”区域逐个点击展开按钮，从 DOM 提取可见文本（效率较低，仅用于关键记录）。
- **分页截断**：若单页返回数量少于请求值，立即停止分页，避免空请求循环。

## Pitfalls
- **Step 2**: 不要硬编码 `type=mail` 过滤，否则会遗漏 WhatsApp 和系统通知。必须抓取所有类型后在前端分类。
- **Step 2**: `userId` 和 `company_id` 必须从 Cookie 和 URL 动态提取，硬编码会导致跨客户抓取失败。
- **Step 2**: 邮件详情接口通常需要 `skip_view_privilege=1` 参数，否则可能因权限检查返回空内容。
