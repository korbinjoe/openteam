# Heartbeat Checklist

## Every Execution
1. Check `.agents/tasks/` for any tasks with status=failed or timed out beyond 30 minutes
2. Check git status for uncommitted workspace changes
3. Read today's memory/YYYY-MM-DD.md for pending follow-up items

## If Anomalies Found
Report to user: "[Fullstack] Attention needed: {description}"

## If All Clear
Reply HEARTBEAT_OK
