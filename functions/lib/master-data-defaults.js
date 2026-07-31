const DEFAULT_MASTER_DATA = {
  work_classification: [
    { key: 'client_work', label: 'Client Work', short_label: 'Client', sort_order: 1 },
    { key: 'internal', label: 'Internal', short_label: 'Internal', sort_order: 2 },
    { key: 'admin', label: 'Admin', short_label: 'Admin', sort_order: 3 },
    { key: 'business_development', label: 'Business Development', short_label: 'Biz Dev', sort_order: 4 },
    { key: 'learning', label: 'Learning', short_label: 'Learning', sort_order: 5 }
  ],
  work_category: [
    { key: 'gst_filing', label: 'GST Filing', sort_order: 1 },
    { key: 'gst_reconciliation', label: 'GST Reconciliation', sort_order: 2 },
    { key: 'income_tax_return', label: 'Income Tax Return', sort_order: 3 },
    { key: 'tds_tcs_filing', label: 'TDS / TCS Filing', sort_order: 4 },
    { key: 'statutory_audit', label: 'Statutory Audit', sort_order: 5 },
    { key: 'tax_audit', label: 'Tax Audit', sort_order: 6 },
    { key: 'internal_audit', label: 'Internal Audit', sort_order: 7 },
    { key: 'roc_mca_filing', label: 'ROC / MCA Filing', sort_order: 8 },
    { key: 'company_incorporation', label: 'Company Incorporation', sort_order: 9 },
    { key: 'accounts_bookkeeping', label: 'Accounts & Bookkeeping', sort_order: 10 },
    { key: 'payroll_processing', label: 'Payroll Processing', sort_order: 11 },
    { key: 'advisory_consultation', label: 'Advisory / Consultation', sort_order: 12 },
    { key: 'client_meeting', label: 'Client Meeting', sort_order: 13 },
    { key: 'internal_meeting', label: 'Internal Meeting', sort_order: 14 },
    { key: 'training_cpd', label: 'Training / CPD', sort_order: 15 },
    { key: 'fema_rbi_compliance', label: 'FEMA / RBI Compliance', sort_order: 16 },
    { key: 'administrative', label: 'Administrative', sort_order: 17 },
    { key: 'other', label: 'Other', sort_order: 18 }
  ],
  udin_assignment: [
    { key: 'certificate', label: 'Certificate', short_label: 'CERT', sort_order: 1 },
    { key: 'consultancy', label: 'Consultancy', short_label: 'CONS', sort_order: 2 },
    { key: 'professional_services', label: 'Professional Services', short_label: 'PS', sort_order: 3 }
  ],
  financial_year: [
    { key: '2024-25', label: '2024-25', short_label: '2024-25', sort_order: 1 },
    { key: '2025-26', label: '2025-26', short_label: '2025-26', sort_order: 2 },
    { key: '2026-27', label: '2026-27', short_label: '2026-27', sort_order: 3 }
  ]
};

function defaultMasterDocumentId(category, key) {
  const normalized = `${category}__${key}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return `default__${normalized}`;
}

function missingDefaultMasterData(existing = []) {
  const presentCategories = new Set(existing.map(item => String(item.category || '').trim().toLowerCase()));
  const missing = [];
  for (const [category, items] of Object.entries(DEFAULT_MASTER_DATA)) {
    if (presentCategories.has(category.toLowerCase())) continue;
    for (const item of items) {
      missing.push({
        id: defaultMasterDocumentId(category, item.key),
        category,
        key: item.key,
        label: item.label,
        short_label: item.short_label || null,
        sort_order: item.sort_order || 0,
        active: true
      });
    }
  }
  return missing;
}

module.exports = { DEFAULT_MASTER_DATA, defaultMasterDocumentId, missingDefaultMasterData };
