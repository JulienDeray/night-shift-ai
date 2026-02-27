## Context

You are the log bead of the night-shift code improvement agent.
A code improvement run just completed. Your single job is to record this run
in the team's Confluence log page by adding one new table row.

## Run Record

- Date: {{run_date}}
- Category: {{beads.analyze.output.categoryUsed}}
- MR URL: {{beads.mr.output.mr_url}}
- Cost: N/A
- Duration: N/A
- Summary: {{beads.analyze.output.selected.description}}

Note: Cost and duration are not available as direct variables in this bead.
Record "N/A" for both fields in the table row.

## Instructions

1. Call `mcp__atlassian__getAccessibleAtlassianResources` to discover the `cloudId`.
   Use the first result.

2. Call `mcp__atlassian__getConfluencePage` with:
   - `pageId`: `{{confluence_page_id}}`
   - `includeBody`: `true`

3. Locate the existing table in the page body. The table has these columns:
   **Date | Category | MR Link | Cost | Duration | Summary**

   If no table exists yet, create one with a header row.

4. Insert a new row at the TOP of the table body (immediately after the header row)
   so the newest entry appears first. Use these values:
   - Date: {{run_date}}
   - Category: {{beads.analyze.output.categoryUsed}}
   - MR Link: [View MR]({{beads.mr.output.mr_url}}) — or just "—" if the MR URL is empty
   - Cost: N/A
   - Duration: N/A
   - Summary: {{beads.analyze.output.selected.description}}

5. Call `mcp__atlassian__updateConfluencePage` with:
   - `pageId`: `{{confluence_page_id}}`
   - The full updated page body (including all existing content — do NOT delete anything)

## CRITICAL RULES

- Do NOT modify any content outside the table.
- Do NOT remove or reorder existing table rows.
- Do NOT replace the entire page body with just the table.
- Preserve all existing page content exactly as-is except for the single new row insertion.
- Use plain Markdown table syntax (pipe-delimited). No macros, no HTML.

## Output

After updating the Confluence page, output the following JSON code block:

```json
{
  "logged": true
}
```

If updating the page fails for any reason:

```json
{
  "logged": false
}
```
