# Security Policy

## Supported Versions

The following versions of Buildable-LA are currently being supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Buildable-LA seriously. If you discover a security vulnerability, please follow these steps:

### How to Report

1. **DO NOT** create a public GitHub issue for the vulnerability
2. Email security concerns to: security@buildable-la.example.com
3. Include the following information:
   - Type of vulnerability
   - Full paths of source file(s) related to the vulnerability
   - Location of the affected source code (tag/branch/commit or direct URL)
   - Step-by-step instructions to reproduce the issue
   - Proof-of-concept or exploit code (if possible)
   - Impact of the issue, including how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours
- **Initial Assessment**: Within 5 business days, we will provide an initial assessment
- **Resolution Timeline**: We aim to resolve critical issues within 30 days
- **Updates**: We will keep you informed about the progress of addressing the vulnerability
- **Credit**: We will credit reporters who help us improve our security (unless you prefer to remain anonymous)

## Security Best Practices

When using Buildable-LA:

### API Keys and Secrets

- **Never commit API keys** to the repository
- Store all secrets in environment variables
- Use `.env.example` as a template, never `.env`
- Rotate API keys regularly
- Use different keys for development and production

### Data Handling

- The application caches API responses locally
- Ensure cache directories are properly secured
- Don't store sensitive property data in public repositories
- Be cautious with personally identifiable information (PII)

### Dependencies

- Regularly update dependencies: `npm update`
- Check for vulnerabilities: `npm audit`
- Fix vulnerabilities: `npm audit fix`
- Review dependency licenses

### Network Security

- All API calls should use HTTPS
- Validate all external data inputs
- Implement rate limiting for API calls
- Monitor for unusual API usage patterns

## Security Features

Buildable-LA includes several security features:

1. **Environment Variable Management**
   - Secrets stored in `.env` files (gitignored)
   - Example configuration provided

2. **Input Validation**
   - Address inputs are sanitized
   - API responses are validated

3. **Secure Defaults**
   - HTTPS enforced for API calls
   - Conservative timeout settings
   - Rate limiting on API requests

4. **Automated Security Scanning**
   - CI/CD pipeline includes security checks
   - Secret scanning in pre-commit hooks
   - Dependency vulnerability scanning

## Known Security Considerations

### Public Data Sources

- The application uses publicly available property data
- No authentication required for public APIs
- Be aware of data privacy regulations in your jurisdiction

### Cache Management

- API responses are cached locally
- Cache files may contain property information
- Ensure proper file permissions on cache directories

### Large File Handling

- Geodatabase files can be very large
- Consider using Git LFS for large binary files
- Monitor disk space usage

## Compliance

This project aims to comply with:

- California Consumer Privacy Act (CCPA)
- General Data Protection Regulation (GDPR) where applicable
- Fair Housing Act requirements

## Security Updates

Security updates will be released as:

- **Critical**: Immediate patch release (x.x.1)
- **High**: Within 7 days
- **Medium**: Within 30 days
- **Low**: Next regular release

Subscribe to security advisories by watching the repository.

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [npm Security Best Practices](https://docs.npmjs.com/packages-and-modules/securing-your-code)

## Contact

For security concerns, please contact:
- Email: security@buildable-la.example.com
- PGP Key: [Available upon request]

For general questions, use GitHub Issues.

---

*This security policy is subject to change. Last updated: 2025-09-22*