---
name: customer-winback-automator
description: >-
  Identify and re-engage lapsed customers through automated multi-stage reactivation sequences. Implement tiered discounting based on historical LTV and establish sunsetting protocols for unengaged contacts.
category: marketing-growth
risk: safe
source: curated
date_added: "2026-03-12"
tags: [retention, win-back, lifecycle-marketing, reactivation]
triggers: ["win back inactive customers", "reactivation campaign setup", "lapsed customer recovery"]
platforms: [shopify, woocommerce, bigcommerce, amazon-seller-central]
difficulty: intermediate
---

# Customer Winback Automator

## Overview

A customer winback strategy targets "lapsed" customers—those who have not purchased within 1.5x to 2x their typical repurchase cycle. Re-acquiring a lapsed customer is 5-10x more cost-effective than acquiring a new one. This skill focuses on building automated sequences that escalate in value, personalizing offers based on historical spend, and maintaining list hygiene through sunsetting.

## The Winback Framework

| Segment | Timing (Days since last order) | Objective | Strategy |
|---------|--------------------------------|-----------|----------|
| **Early Lapse** | 45–90 Days | Gentle Reminder | "We missed you" + New arrivals. |
| **Mid-Lapse** | 91–180 Days | Incentive-Driven | 10-15% discount or Free Gift. |
| **Deep-Lapse** | 181–365 Days | Aggressive Recovery | 25%+ discount or "Last Chance" offer. |
| **Dead/Sunset** | > 365 Days | List Hygiene | Re-permission email or final suppression. |

---

## Execution Steps

### Step 1: Lapsed Segment Identification

#### Shopify Admin
1.  Navigate to **Customers**.
2.  **Filter:** Add filter "Last order date" and set to "before [Date X]" (where X is 90 days ago).
3.  **Segment:** Save this as "Lapsed Customers - 90 Days."
4.  **Automation:** Use **Shopify Flow** (built-in) to trigger an internal notification or tag a customer when they cross the 90-day threshold without an order.

#### WooCommerce Admin
1.  Go to **Analytics > Customers**.
2.  Filter by "Last Active" date. 
3.  Export the list of customers who haven't purchased in >120 days for manual campaign upload if no automation tool is present.

### Step 2: Tiered Offer Logic (LTV-Based)

Not all lapsed customers are worth the same investment. Use historical Lifetime Value (LTV) to determine your "Recovery CAC."

**Decision Logic:**
- **High-Value Lapsed (LTV > $200):** Offer a "High Friction/High Reward" incentive (e.g., $20 off a $50 order). These customers have a proven affinity for the brand.
- **Low-Value Lapsed (LTV < $50):** Offer a "Low Friction" incentive (e.g., Free Shipping). Avoid deep discounts that may result in a negative contribution margin on the recovery sale.

### Step 3: Multi-Stage Sequence Design

Build a 3-step sequence to maximize recovery while minimizing "Unsubscribe" rates.

1.  **Email 1 (The Reconnect):** "It's been a while." Focus on social proof, new collections, or "best sellers" since their last visit. No discount.
2.  **Email 2 (The Incentive - 5 days later):** "A little something to say welcome back." Provide a unique, time-bound discount code (e.g., 48 hours). 
3.  **Email 3 (The Final Call - 7 days later):** "Last chance for your welcome back gift." Create urgency.

**Edge Case: The "Discount Hunter"**
If a customer only ever purchases when a winback code is sent, they are a "Discount Hunter." Use **Shopify Flow** to exclude customers from winback sequences if they have used a "WINBACK" tagged discount code in the last 12 months.

### Step 4: Sunsetting & List Hygiene

Continuing to email customers who have been inactive for >12 months damages your domain's "Sender Reputation," causing your emails to land in the "Promotions" or "Spam" folders for active customers.

1.  **Re-permission:** At 365 days of inactivity, send one final email: "Should we say goodbye?" with a clear CTA to "Stay on the list."
2.  **Suppression:** If no open/click occurs within 14 days of the re-permission email, **Suppress/Archive** the profile in your CRM. Do not delete the data (for historical reporting), but stop all marketing sends.

---

## Benchmarks & Performance Targets

| Metric | Target (Good) | Target (Elite) |
|--------|---------------|----------------|
| **Reactivation Rate** | 5% - 8% | > 15% |
| **Winback ROI** | 4:1 | > 10:1 |
| **AOV on Recovery Sale** | 90% of Baseline | > 110% of Baseline |
| **Unsubscribe Rate** | < 1.0% | < 0.3% |

---

## Troubleshooting & Common Pitfalls

- **The "Zombie" Open:** A customer who opens every email but hasn't bought in 2 years. These are "Low Intent" profiles. Treat them as "Lapsed" even if they are "Active" in email stats.
- **Overlapping Flows:** Ensure a customer in a "Winback" flow is excluded from "General Newsletter" sends to avoid inbox fatigue. 
- **Inventory Mismatch:** Never feature out-of-stock items in winback emails. Use "Dynamic Product Blocks" that only show items with >10 units in stock.
- **Timing Misalignment:** If you sell a 30-day supply (e.g., supplements), a 90-day winback is too late. Your "Early Lapse" should start at Day 35.
