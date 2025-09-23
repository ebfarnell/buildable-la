import fs from 'fs';
import { dbInit } from './storage.js';

export function generateRentalReport(dbPath: string, outputPath: string) {
  const db = dbInit(dbPath);

  // Get overall statistics
  const stats = db
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN buildable_sqft >= 770 THEN 1 END) as viable,
      ROUND(AVG(buildable_sqft), 0) as avg_buildable,
      ROUND(MAX(buildable_sqft), 0) as max_buildable,
      ROUND(AVG(lot_area_sqft), 0) as avg_lot
    FROM results
  `,
    )
    .get() as any;

  // Get ZIP code breakdown
  const byZip = db
    .prepare(
      `
    SELECT
      zip,
      COUNT(*) as count,
      COUNT(CASE WHEN buildable_sqft >= 770 THEN 1 END) as viable,
      ROUND(AVG(buildable_sqft), 0) as avg_buildable
    FROM results
    GROUP BY zip
    ORDER BY zip
  `,
    )
    .all() as any[];

  // Get top properties for rental
  const topProperties = db
    .prepare(
      `
    SELECT
      apn,
      zip,
      address,
      ROUND(lot_area_sqft, 0) as lot_sqft,
      ROUND(buildable_sqft, 0) as buildable_sqft,
      CASE
        WHEN buildable_sqft >= 1200 THEN 'Premium (1200+ sqft)'
        WHEN buildable_sqft >= 900 THEN 'Standard (900-1200 sqft)'
        ELSE 'Compact (770-900 sqft)'
      END as adu_category,
      zone,
      ROUND(
        (buildable_sqft / 1000.0) * 50 +
        MIN(lot_area_sqft / 500.0, 30) +
        CASE WHEN zone = 'R1' THEN 20 ELSE 10 END,
        1
      ) as rental_score
    FROM results
    WHERE buildable_sqft >= 770
    ORDER BY rental_score DESC
    LIMIT 25
  `,
    )
    .all() as any[];

  // ADU size distribution
  const sizeDistribution = db
    .prepare(
      `
    SELECT
      CASE
        WHEN buildable_sqft >= 1200 THEN 'Premium (1200+ sqft)'
        WHEN buildable_sqft >= 900 THEN 'Standard (900-1200 sqft)'
        WHEN buildable_sqft >= 770 THEN 'Compact (770-900 sqft)'
        ELSE 'Below Minimum'
      END as category,
      COUNT(*) as count
    FROM results
    GROUP BY category
    ORDER BY
      CASE category
        WHEN 'Premium (1200+ sqft)' THEN 1
        WHEN 'Standard (900-1200 sqft)' THEN 2
        WHEN 'Compact (770-900 sqft)' THEN 3
        ELSE 4
      END
  `,
    )
    .all() as any[];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ADU Rental Potential Report - Westlake Village & Agoura Hills</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      color: #34495e;
      margin-top: 30px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 5px;
    }
    .summary {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
    }
    .stat-label {
      font-size: 0.9em;
      opacity: 0.9;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      margin: 20px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    th {
      background: #3498db;
      color: white;
      padding: 12px;
      text-align: left;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #eee;
    }
    tr:hover {
      background: #f8f9fa;
    }
    .premium {
      background: #d4edda;
      color: #155724;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .standard {
      background: #cce5ff;
      color: #004085;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .compact {
      background: #fff3cd;
      color: #856404;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .insights {
      background: #e8f4fd;
      border-left: 4px solid #3498db;
      padding: 15px;
      margin: 20px 0;
    }
    .footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      color: #666;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <h1>ADU Rental Potential Analysis Report</h1>
  <p><strong>Analysis Area:</strong> Westlake Village (91361) & Agoura Hills (91301) - Los Angeles County</p>
  <p><strong>Target Market:</strong> Properties suitable for ADU development with high rental potential</p>

  <div class="summary">
    <h2>Executive Summary</h2>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Total Properties Analyzed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.viable}</div>
        <div class="stat-label">ADU-Viable Properties (≥770 sqft)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${((stats.viable / stats.total) * 100).toFixed(1)}%</div>
        <div class="stat-label">Viability Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.avg_buildable}</div>
        <div class="stat-label">Avg Buildable Area (sqft)</div>
      </div>
    </div>
  </div>

  <div class="insights">
    <h3>Key Market Insights</h3>
    <ul>
      <li><strong>Prime Rental Market:</strong> These areas are adjacent to Thousand Oaks and California Lutheran University, making them attractive for student and professional rentals.</li>
      <li><strong>High ADU Potential:</strong> ${((stats.viable / stats.total) * 100).toFixed(1)}% of properties can support ADUs of at least 770 sqft.</li>
      <li><strong>Westlake Village (91361):</strong> Features larger lots averaging ${byZip.find((z) => z.zip === '91361')?.avg_buildable || 'N/A'} sqft buildable area - ideal for premium ADUs.</li>
      <li><strong>Agoura Hills (91301):</strong> More modest lot sizes but still viable for standard ADUs, with good proximity to US-101 corridor.</li>
      <li><strong>Rental Strategy:</strong> Properties with 900+ sqft buildable area can command premium rents, especially those near amenities and transportation.</li>
    </ul>
  </div>

  <h2>Top 25 Properties for ADU Rental Development</h2>
  <table>
    <thead>
      <tr>
        <th>Rank</th>
        <th>APN</th>
        <th>ZIP</th>
        <th>Address</th>
        <th>Lot Size (sqft)</th>
        <th>Buildable Area (sqft)</th>
        <th>ADU Category</th>
        <th>Rental Score</th>
      </tr>
    </thead>
    <tbody>
      ${topProperties
        .map(
          (p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${p.apn}</td>
          <td>${p.zip}</td>
          <td>${p.address || 'N/A'}</td>
          <td>${p.lot_sqft.toLocaleString()}</td>
          <td><strong>${p.buildable_sqft.toLocaleString()}</strong></td>
          <td>
            <span class="${p.adu_category.includes('Premium') ? 'premium' : p.adu_category.includes('Standard') ? 'standard' : 'compact'}">
              ${p.adu_category}
            </span>
          </td>
          <td>${p.rental_score}</td>
        </tr>
      `,
        )
        .join('')}
    </tbody>
  </table>

  <h2>ADU Size Distribution</h2>
  <table>
    <thead>
      <tr>
        <th>Category</th>
        <th>Count</th>
        <th>Percentage</th>
        <th>Rental Potential</th>
      </tr>
    </thead>
    <tbody>
      ${sizeDistribution
        .map(
          (d) => `
        <tr>
          <td>${d.category}</td>
          <td>${d.count}</td>
          <td>${((d.count / stats.total) * 100).toFixed(1)}%</td>
          <td>${
            d.category.includes('Premium')
              ? 'Highest - $3,000-4,000+/mo'
              : d.category.includes('Standard')
                ? 'Strong - $2,500-3,000/mo'
                : d.category.includes('Compact')
                  ? 'Good - $2,000-2,500/mo'
                  : 'Not viable for ADU'
          }</td>
        </tr>
      `,
        )
        .join('')}
    </tbody>
  </table>

  <h2>Analysis by ZIP Code</h2>
  <table>
    <thead>
      <tr>
        <th>ZIP Code</th>
        <th>Area Name</th>
        <th>Properties Analyzed</th>
        <th>ADU Viable</th>
        <th>Viability Rate</th>
        <th>Avg Buildable (sqft)</th>
      </tr>
    </thead>
    <tbody>
      ${byZip
        .map(
          (z) => `
        <tr>
          <td>${z.zip}</td>
          <td>${z.zip === '91361' ? 'Westlake Village (LA County portion)' : 'Agoura Hills'}</td>
          <td>${z.count}</td>
          <td>${z.viable}</td>
          <td>${((z.viable / z.count) * 100).toFixed(1)}%</td>
          <td>${z.avg_buildable.toLocaleString()}</td>
        </tr>
      `,
        )
        .join('')}
    </tbody>
  </table>

  <h2>Rental Market Recommendations</h2>
  <div class="insights">
    <h3>Investment Strategy</h3>
    <ol>
      <li><strong>Target Premium Properties:</strong> Focus on lots with 1200+ sqft buildable area for maximum rental income.</li>
      <li><strong>Location Priority:</strong> Properties in Westlake Village (91361) command higher rents due to proximity to corporate offices and upscale amenities.</li>
      <li><strong>Student Market:</strong> Properties within 3-5 miles of California Lutheran University are ideal for student rentals (located in nearby Thousand Oaks).</li>
      <li><strong>Professional Market:</strong> Both areas attract professionals working in Thousand Oaks, Calabasas, and the western San Fernando Valley.</li>
      <li><strong>Transportation Access:</strong> Properties near US-101 freeway access points offer convenience for commuters.</li>
    </ol>

    <h3>Expected Rental Rates (2024 Market)</h3>
    <ul>
      <li><strong>Premium ADUs (1200+ sqft):</strong> $3,000-4,000+ per month</li>
      <li><strong>Standard ADUs (900-1200 sqft):</strong> $2,500-3,000 per month</li>
      <li><strong>Compact ADUs (770-900 sqft):</strong> $2,000-2,500 per month</li>
    </ul>

    <h3>Marketing Advantages</h3>
    <ul>
      <li>Excellent schools (Las Virgenes Unified School District)</li>
      <li>Safe, family-friendly neighborhoods</li>
      <li>Access to hiking trails and recreational areas</li>
      <li>Proximity to shopping and dining in The Promenade at Westlake</li>
      <li>Quick access to beaches (Malibu ~20 minutes)</li>
    </ul>
  </div>

  <div class="footer">
    <p>Generated: ${new Date().toISOString().split('T')[0]}</p>
    <p>Analysis based on Los Angeles County parcel data with standard California ADU setback requirements</p>
    <p>Note: Thousand Oaks is in Ventura County; this analysis covers adjacent LA County areas</p>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(`Report generated: ${outputPath}`);
  return { stats, topProperties: topProperties.length };
}

// CLI usage
if (process.argv[1].endsWith('rental_report.ts')) {
  const dbPath = process.argv[2] || 'westlake-agoura.db';
  const outputPath = process.argv[3] || 'out/rental_report.html';

  generateRentalReport(dbPath, outputPath);
}
