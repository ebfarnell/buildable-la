#!/bin/bash

# Simple secrets scanner for CI
# Returns 0 (success) even if secrets found - advisory only
# Patterns based on common secret formats

echo "🔍 Scanning for potential secrets..."

FOUND_SECRETS=0
TEMP_FILE=$(mktemp)

# Patterns to search for
PATTERNS=(
  # API Keys
  "api[_-]?key.*=.*['\"][a-zA-Z0-9]{20,}"
  "apikey.*=.*['\"][a-zA-Z0-9]{20,}"

  # AWS
  "AKIA[0-9A-Z]{16}"
  "aws[_-]?access[_-]?key[_-]?id.*=.*['\"][A-Z0-9]{20}"
  "aws[_-]?secret[_-]?access[_-]?key.*=.*['\"][a-zA-Z0-9/+=]{40}"

  # GitHub
  "gh[pousr]_[A-Za-z0-9_]{36,}"
  "github[_-]?token.*=.*['\"][a-zA-Z0-9]{40}"

  # Generic secrets
  "password.*=.*['\"][^'\"]{8,}"
  "secret.*=.*['\"][a-zA-Z0-9]{20,}"
  "token.*=.*['\"][a-zA-Z0-9]{20,}"

  # Private keys
  "-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY"

  # Connection strings
  "mongodb\+srv://[^:]+:[^@]+@"
  "postgres://[^:]+:[^@]+@"
  "mysql://[^:]+:[^@]+@"
  "redis://[^:]+:[^@]+@"
)

# Files to exclude from scanning
EXCLUDE_PATTERNS=(
  "node_modules"
  ".git"
  "dist"
  "build"
  ".cache"
  ".trash"
  "*.min.js"
  "*.map"
  "package-lock.json"
  "pnpm-lock.yaml"
  "yarn.lock"
)

# Build grep exclude arguments
EXCLUDE_ARGS=""
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  EXCLUDE_ARGS="$EXCLUDE_ARGS --exclude-dir=$pattern --exclude=$pattern"
done

# Scan for each pattern
for pattern in "${PATTERNS[@]}"; do
  # Use grep -r with extended regex, case insensitive
  # Suppress errors, show only filename and line number
  grep -rEin "$pattern" . $EXCLUDE_ARGS 2>/dev/null | head -20 >> "$TEMP_FILE"
done

# Check if any secrets were found
if [ -s "$TEMP_FILE" ]; then
  echo "⚠️  Potential secrets found:"
  echo "----------------------------"
  # Remove duplicates and limit output
  sort -u "$TEMP_FILE" | head -50
  FOUND_SECRETS=1
else
  echo "✅ No obvious secrets detected"
fi

# Clean up
rm -f "$TEMP_FILE"

# Exit with 0 (advisory only - don't fail CI)
if [ $FOUND_SECRETS -eq 1 ]; then
  echo ""
  echo "⚠️  Please review the above findings and ensure no real secrets are committed"
  echo "    Add false positives to .gitignore or use environment variables"
fi

exit 0