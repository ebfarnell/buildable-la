# Contributing to Buildable-LA

Thank you for your interest in contributing to Buildable-LA! This document provides guidelines for contributing to the project.

## Getting Started

### Prerequisites

- Node.js 20.x or higher (use `.nvmrc` for exact version)
- npm 9.x or higher
- Git

### Setup

1. Clone the repository
```bash
git clone https://github.com/ebfarnell/buildable-la.git
cd buildable-la
```

2. Install dependencies
```bash
cd backyard-scout
npm install
```

3. Copy environment variables
```bash
cp .env.example .env
# Edit .env with your API keys
```

4. Run the development server
```bash
npm run dev
```

## Development Workflow

### Branch Naming Convention

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions or changes
- `chore/description` - Maintenance tasks

### Commit Message Style

Follow the conventional commits specification:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Maintenance tasks

Examples:
```
feat(api): add support for LA County parcel data
fix(detector): correct building area calculation
docs: update README with new CLI options
```

### Code Style

The project uses automated formatting and linting:

```bash
# Check TypeScript types
npm run typecheck

# Run linter
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting
npm run format:check
```

Pre-commit hooks automatically run linting and formatting on staged files.

## Pull Request Process

### PR Checklist

Before submitting a PR, ensure:

- [ ] Code follows the project's style guidelines
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Prettier formatting applied (`npm run format:check`)
- [ ] Tests pass (if applicable)
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow conventions
- [ ] Branch is up to date with main
- [ ] PR description clearly explains changes

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested locally
- [ ] Added/updated tests
- [ ] All tests pass

## Screenshots (if applicable)
Add screenshots here

## Additional Notes
Any additional information
```

## Local Development

### Running Specific Tools

```bash
# Quick property check
cd backyard-scout
npx tsx src/tools/quick_check.ts "address"

# Detailed ADU analysis
npx tsx src/analyze_requested_properties.ts "address"

# Find lot splitting opportunities
npx tsx src/tools/lot_split_analyzer.ts --zip 91301

# Area-wide search
npx tsx src/tools/area_adu_search.ts --city "City Name"
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npx tsx test-apis.js

# Test building detection
npx tsx test-building-endpoints.js
```

### Debugging

1. Use console.log for quick debugging
2. Set `DEBUG=*` environment variable for verbose logging
3. Check cache directory for API responses
4. Review logs in the console

## Project Structure

```
Buildable-LA/
├── backyard-scout/          # Main application
│   ├── src/                # Source code
│   │   ├── tools/          # Analysis tools
│   │   ├── services/       # API services
│   │   └── formulas/       # Calculations
│   ├── cache/              # API cache
│   └── out/                # Output files
├── scripts/                # Utility scripts
├── docs/                   # Documentation
└── .github/                # GitHub configs
```

## Common Issues

### API Key Problems
- Ensure `.env` file has valid API keys
- Check API rate limits
- Clear cache if getting stale data: `rm -rf backyard-scout/cache/*`

### TypeScript Errors
- Run `npm run typecheck` to see all errors
- Check import paths match tsconfig paths
- Ensure all dependencies have types

### Building Detection Issues
- Building data may not be available for all areas
- Check confidence scores in output
- Use baseline estimates when data unavailable

## Code Review Guidelines

Reviewers should check for:

1. **Functionality**: Does the code do what it's supposed to?
2. **Performance**: Are there any obvious performance issues?
3. **Security**: No exposed secrets or vulnerabilities
4. **Style**: Follows project conventions
5. **Tests**: Adequate test coverage
6. **Documentation**: Clear comments and updated docs

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions
- Contact maintainers for sensitive issues

Thank you for contributing!