#!/bin/bash
# Backyard Scout - Project Cleanup and Maintenance Script
# Run monthly or as needed to keep project organized

echo "🧹 Backyard Scout Cleanup Starting..."

# Navigate to backyard-scout directory
cd "$(dirname "$0")/.." || exit

# 1. Clean old cache files (older than 7 days)
echo "📁 Cleaning cache older than 7 days..."
find cache -type f -mtime +7 -delete 2>/dev/null
echo "   ✓ Cache cleaned"

# 2. Archive old output files (older than 30 days)
echo "📦 Archiving old outputs..."
mkdir -p archive/old_outputs
find out -name "*.json" -mtime +30 -exec mv {} archive/old_outputs/ \; 2>/dev/null
find out -name "*.csv" -mtime +30 -exec mv {} archive/old_outputs/ \; 2>/dev/null
find out -name "*.html" -mtime +30 -exec mv {} archive/old_outputs/ \; 2>/dev/null
echo "   ✓ Old outputs archived"

# 3. Clean log files (keep last 100 lines)
echo "📝 Trimming log files..."
for logfile in logs/*.log; do
    if [ -f "$logfile" ]; then
        tail -n 100 "$logfile" > "$logfile.tmp"
        mv "$logfile.tmp" "$logfile"
    fi
done
echo "   ✓ Logs trimmed"

# 4. Remove duplicate cache entries
echo "🔍 Removing duplicate cache entries..."
for dir in cache/*/; do
    if [ -d "$dir" ]; then
        # Remove duplicate files (same checksum)
        find "$dir" -type f -exec md5 {} \; | sort | uniq -d -w 32 | cut -c 35- | xargs rm -f 2>/dev/null
    fi
done
echo "   ✓ Duplicates removed"

# 5. Report disk usage
echo ""
echo "📊 Disk Usage Report:"
echo "   Cache: $(du -sh cache 2>/dev/null | cut -f1)"
echo "   Outputs: $(du -sh out 2>/dev/null | cut -f1)"
echo "   Logs: $(du -sh logs 2>/dev/null | cut -f1)"
echo "   Archive: $(du -sh archive 2>/dev/null | cut -f1)"
echo "   Total: $(du -sh . 2>/dev/null | cut -f1)"

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "💡 Tips:"
echo "   - Run 'npm update' to update dependencies"
echo "   - Run 'npx tsx tests/test_api_services.ts' to verify APIs"
echo "   - Check AGENT_FIXES_AND_BEST_PRACTICES.md for troubleshooting"