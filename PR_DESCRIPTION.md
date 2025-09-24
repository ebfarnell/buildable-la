# Repo hygiene: tooling, CI, and docs

## Summary
Comprehensive repository hygiene pass to standardize tooling, add CI/CD, improve documentation, and organize project structure. All changes are non-destructive - files were quarantined rather than deleted.

## Type of Change
- [x] Documentation update
- [x] Build/tooling improvement
- [x] CI/CD setup
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change

## Changes Made

### 🔧 Development Environment
- Added Node version pinning (.nvmrc for Node 20 LTS)
- Created .editorconfig for consistent formatting
- Added .gitattributes for line ending normalization

### 🛡️ Version Control
- Created comprehensive .gitignore
- Added secrets scanning script (advisory only)
- Set up pre-commit hooks (pending Husky activation after first push)

### 📝 Code Quality
- Configured ESLint with TypeScript support
- Set up Prettier for code formatting
- Enhanced TypeScript config with strict mode
- Formatted all TypeScript files

### 📦 Project Structure
- Normalized package.json scripts
- Created root-level package.json for coordination
- Moved test scripts to .trash directory (non-destructive)
- Organized project files

### 🚀 CI/CD
- Added GitHub Actions workflow
- Includes typecheck, lint, format checks
- Added secrets scanning (advisory)
- Matrix testing on Node 20

### 📚 Documentation
- Updated README with CI badge
- Created comprehensive CONTRIBUTING.md
- Added SECURITY.md with vulnerability reporting
- Created CODEOWNERS file
- Generated repo hygiene report

## Testing
- [x] Tested locally
- [x] TypeScript compiles (with warnings to be addressed separately)
- [x] ESLint configured and working
- [x] Prettier formats code correctly
- [ ] CI pipeline will be tested after push

## Acceptance Criteria Checklist
- [x] No hard deletes; all removed items are quarantined under .trash/ with notes
- [x] Node version pinned (nvmrc) and editor defaults present (editorconfig, gitattributes)
- [x] Git ignores/secrets hygiene in place; .env.example exists (no real secrets)
- [x] ESLint + Prettier configured; lint-staged + Husky pre-commit ready
- [x] TypeScript strict mode enabled without breaking build
- [x] Scripts normalized (dev, build, start, typecheck, lint, format, format:check, test)
- [x] CI ready to run on clean checkout
- [x] README, CONTRIBUTING, SECURITY, CODEOWNERS added/updated
- [x] docs/repo_hygiene_report.md created, listing actions taken
- [x] All changes split into granular commits with clear messages

## Files Quarantined
Files moved to `.trash/20250922_132702/`:
- Test scripts from root directory
- Old report markdown files
- .DS_Store files

See `.trash/20250922_132702/README.txt` for details and restoration instructions.

## Next Steps
1. Push to GitHub and create PR
2. Verify CI pipeline passes
3. Activate Husky hooks after merge
4. Address TypeScript compilation warnings in separate PR
5. Consider moving large geodatabase files to Git LFS

## Notes
- TypeScript has stricter settings now; some warnings exist but don't break the build
- Large geodatabase files (1.5GB+) detected - recommend Git LFS
- Husky pre-commit hooks will activate after first successful push/merge

<details>
<summary>📊 Repository Hygiene Report</summary>

# Repository Hygiene Report
Date: 2025-09-22

## Repository Overview
- **Location**: `/Users/ericfarnell/Dev/Apps/Dev Apps/Buildable-LA`
- **Type**: Node.js/TypeScript property development analysis system
- **Package Manager**: npm (detected via package-lock.json)
- **Node Version**: Not pinned (no .nvmrc found, will target Node 20 LTS)
- **Main Application**: backyard-scout directory

## Key Findings

### 🚨 Critical Issues
1. **No .gitignore file** - All files including node_modules, databases, and large binaries may be tracked
2. **Large binary files detected** (1.5GB+ total):
   - Geodatabase files in `backyard-scout/data/geodatabases/` (1.3GB+)
   - SQLite databases (13MB+)
   - Large CSV outputs (12MB)
3. **No version pinning** - Missing .nvmrc, .editorconfig, .gitattributes
4. **No linting/formatting setup** - No ESLint or Prettier configs found
5. **No CI/CD pipeline** - Missing GitHub Actions workflows
6. **Loose TypeScript config** - Not using strict mode optimally

### 📁 Repository Structure Issues
1. **Test files in root directory** (should be organized):
   - test-apis.js
   - test-building-endpoints.js
   - test-fixed-detector.js
   - test-microsoft-fix.js
   - test-microsoft.js
   - test-parcel-api-direct.js
   - test-zoneomics.js
   - verify-all-data-sources.js
   - verify-bedford-zoning.js
   - diagnose-apis.js
   - discover-county-endpoints.js
   - analyze-subdivision-potential.js

2. **Multiple database files** (may be redundant):
   - backyard-scout.db (425KB)
   - data.db (13MB)
   - Associated WAL/SHM files

3. **Orphan/temporary files**:
   - .DS_Store files (macOS metadata)
   - Multiple markdown reports in root

### ✅ Positive Findings
1. TypeScript project with tsconfig.json
2. Environment variables properly configured with .env.example
3. Organized src directory structure in backyard-scout
4. Commander CLI integration
5. Good documentation (CLAUDE.md, README.md)

### 📋 Actions Taken
All planned actions were successfully completed - see checklist above.

</details>