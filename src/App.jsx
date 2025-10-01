// src/App.jsx
import React, { useState, useEffect } from "react";
import {
  Calendar,
  Users,
  FileText,
  DollarSign,
  Database,
  Clock,
  AlertCircle,
  CheckCircle,
  Settings,
  Upload,
  Search
} from "lucide-react";
import Papa from "papaparse"; // optional, kept only if frontend upload ever used

const PROXY_URL = import.meta.env.VITE_PROXY_URL || import.meta.env.REACT_APP_PROXY_URL || 'https://bookkeeping-app-rmvi.onrender.com';

// central endpoints used by frontend
const CSV_DATA_URL = `${PROXY_URL}/api/csv-data`;
const GOOGLE_APPS_SCRIPT_URL = `${PROXY_URL}/api/bookkeeping`;

/* ---------- AutocompleteInput component (reusable) ---------- */
const AutocompleteInput = ({
  name,
  value,
  onChange,
  suggestions = [],
  placeholder,
  label,
  required,
  style,
  onSelect
}) => {
  const [filteredSuggestions, setFilteredSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  useEffect(() => {
    if (value && value.length > 0) {
      const filtered = suggestions
        .filter(s => s && s.toString().toLowerCase().includes(value.toString().toLowerCase()))
        .slice(0, 20);
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setActiveSuggestion(-1);
    } else {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    }
  }, [value, suggestions]);

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion(prev => Math.min(prev + 1, filteredSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion(prev => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      if (activeSuggestion >= 0) {
        e.preventDefault();
        selectSuggestion(filteredSuggestions[activeSuggestion]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    }
  };

  const selectSuggestion = (val) => {
    const synthetic = { target: { name, value: val } };
    onChange(synthetic);
    if (onSelect) onSelect(val);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  };

  const handleBlur = () => {
    // delay so clicks register
    setTimeout(() => {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
    }, 150);
  };

  return (
    <div style={{ position: "relative" }}>
      {label && (
        <label style={{ display: "block", fontSize: 14, fontWeight: 500, color: "#374151", marginBottom: 8 }}>
          {label} {required && <span style={{ color: "#ef4444" }}>*</span>}
        </label>
      )}
      <div style={{ position: "relative" }}>
        <input
          type="text"
          name={name}
          value={value || ""}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          onFocus={() => value && value.length > 0 && setShowSuggestions(filteredSuggestions.length > 0)}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          style={{
            ...style,
            paddingRight: 40,
            width: "100%",
            padding: "12px",
            borderRadius: 8,
            border: "1px solid #d1d5db"
          }}
        />
        <Search style={{
          position: "absolute",
          right: 12,
          top: "50%",
          transform: "translateY(-50%)",
          width: 16,
          height: 16,
          color: "#9ca3af"
        }} />
      </div>

      {showSuggestions && filteredSuggestions.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          backgroundColor: "white",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
          maxHeight: 220,
          overflowY: "auto",
          zIndex: 1000
        }}>
          {filteredSuggestions.map((suggestion, idx) => (
            <div
              key={`${suggestion}-${idx}`}
              onMouseDown={() => selectSuggestion(suggestion)}
              style={{
                padding: 12,
                cursor: "pointer",
                backgroundColor: idx === activeSuggestion ? "#f3f4f6" : "white",
                borderBottom: idx < filteredSuggestions.length - 1 ? "1px solid #e5e7eb" : "none"
              }}
              onMouseEnter={() => setActiveSuggestion(idx)}
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------- Helpers for header matching ---------- */
const normalize = (s) => (s || "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
const findHeader = (headers = [], variants = []) => {
  if (!headers || headers.length === 0) return null;
  const H = headers.map(h => ({ raw: h, norm: normalize(h) }));
  // exact matches first
  for (const v of variants) {
    const vn = normalize(v);
    const hit = H.find(x => x.norm === vn);
    if (hit) return hit.raw;
  }
  // then partial containment
  for (const v of variants) {
    const vn = normalize(v);
    const hit = H.find(x => x.norm.includes(vn) || vn.includes(x.norm));
    if (hit) return hit.raw;
  }
  return null;
};

/* ---------- Main BookkeepingForm component ---------- */
const BookkeepingForm = () => {
  // Full form state (keeps the original fields you had)
  const [formData, setFormData] = useState({
    // Auto fields
    sNo: '',
    tatAuto: '',
    month: '',
    totalBankEntries: 0,
    totalTransactionsOthers: 0,
    totalEntries: 0,

    // Manual - Basic Info
    startDateManual: '',
    bookkeeperStartDate: '',
    estimatedDays: '',
    outputDate: '',
    urgent: false,
    clientReference: '',
    responsibleUser: '',
    fileName: '',
    companyNo: '',
    companyName: '',
    companyUTR: '',
    fileSource: '',
    status: 'pending',
    fileAllocatedTo: '',
    bookkeeper: '',
    reviewer: '',
    fileType: '',
    period: '',
    workDone: '',

    // Bank related
    noOfBankAccounts: '',
    bankTransaction1: '',
    bankTransaction2: '',
    bankTransaction3: '',
    bankTransaction4: '',
    bankTransaction5: '',
    bankTransaction6: '',

    // Sales and other transactions
    preparingSalesList: '',
    noOfSaleInvoices: '',
    noOfPINs: '',
    noOfWages: '',
    bankReceivedIn: '',
    pinsGivenStartDate: '',
    pinsGivenDoneDate: '',
    notes: '',
    fees: ''
  });

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState({ type: '', message: '' });
  const [showSetupInstructions, setShowSetupInstructions] = useState(false);

  // CSV/autocomplete lists / maps (populated from backend CSV)
  const [csvLoaded, setCsvLoaded] = useState(false);
  const [csvError, setCsvError] = useState('');
  const [companyNumbers, setCompanyNumbers] = useState([]);
  const [companyNames, setCompanyNames] = useState([]);
  const [clientReferences, setClientReferences] = useState([]);
  const [fileNames, setFileNames] = useState([]);
  const [bookkeepers, setBookkeepers] = useState([]);
  const [reviewers, setReviewers] = useState([]);
  const [companyDataMap, setCompanyDataMap] = useState(new Map());

  // init serial + month
  useEffect(() => {
    const now = new Date();
    const currentMonth = now.toLocaleString('default', { month: 'long', year: 'numeric' });
    const autoSNo = `BK${Date.now().toString().slice(-6)}`;
    setFormData(prev => ({ ...prev, sNo: autoSNo, month: currentMonth }));
  }, []);

  // totals calculation when bank transaction / others change
  useEffect(() => {
    const bankTransactions = [
      formData.bankTransaction1,
      formData.bankTransaction2,
      formData.bankTransaction3,
      formData.bankTransaction4,
      formData.bankTransaction5,
      formData.bankTransaction6
    ];
    const totalBankEntries = bankTransactions.reduce((sum, val) => sum + (parseInt(val) || 0), 0);
    const totalTransactionsOthers = (parseInt(formData.noOfSaleInvoices) || 0) +
                                   (parseInt(formData.noOfPINs) || 0) +
                                   (parseInt(formData.noOfWages) || 0);
    const totalEntries = totalBankEntries + totalTransactionsOthers;
    setFormData(prev => ({ ...prev, totalBankEntries, totalTransactionsOthers, totalEntries }));
  }, [
    formData.bankTransaction1, formData.bankTransaction2, formData.bankTransaction3,
    formData.bankTransaction4, formData.bankTransaction5, formData.bankTransaction6,
    formData.noOfSaleInvoices, formData.noOfPINs, formData.noOfWages
  ]);

  // input change handler
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  // When user picks company number, auto-fill companyName, companyUTR, clientReference, bookkeeper
  const handleCompanyNumberSelect = (companyNo) => {
    const data = companyDataMap.get(companyNo);
    if (data) {
      setFormData(prev => ({
        ...prev,
        companyNo,
        companyName: data.companyName || prev.companyName,
        companyUTR: data.companyUTR || prev.companyUTR,
        clientReference: data.clientReference || prev.clientReference,
        bookkeeper: prev.bookkeeper || data.bookkeeper || prev.bookkeeper
      }));
    } else {
      setFormData(prev => ({ ...prev, companyNo }));
    }
  };

  // Validate required fields
  const validateForm = () => {
    const requiredFields = [
      { field: 'clientReference', label: 'Client Reference' },
      { field: 'fileName', label: 'File Name' },
      { field: 'fileType', label: 'File Type' }
    ];
  
    const missing = requiredFields.filter(r => !formData[r.field]);
  
    // Conditional requirement: either Company No or UTR must be filled
    if (!formData.companyNo && !formData.companyUTR) {
      missing.push({ field: 'companyNo', label: 'Company Number or UTR' });
    }
  
    if (missing.length > 0) {
      return { isValid: false, message: `Please fill out required fields: ${missing.map(f => f.label).join(', ')}` };
    }
  
    return { isValid: true };
  };
  

  // Fetch CSV data from backend proxy on mount
  useEffect(() => {
    let mounted = true;
  
    const PROXY_URL = import.meta.env.VITE_PROXY_URL || 'https://bookkeeping-app-rmvi.onrender.com';
    const url = `${PROXY_URL}/api/csv-data`;
  
    console.log("Fetching CSV from:", url);
  
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch CSV data: ${res.status}`);
        return res.json();
      })
      .then(payload => {
        if (!mounted) return;
  
        // Accept multiple payload shapes for compatibility with different proxies:
        let rows = [];
        if (Array.isArray(payload)) {
          rows = payload;
        } else if (payload && Array.isArray(payload.data)) {
          rows = payload.data;
        } else if (payload && Array.isArray(payload.rows)) {
          rows = payload.rows;
        } else {
          setCsvLoaded(false);
          setCsvError('No CSV rows found in response');
          console.info('CSV data empty or not an array. Payload:', payload);
          return;
        }
  
        if (!Array.isArray(rows) || rows.length === 0) {
          setCsvLoaded(false);
          setCsvError('no rows in CSV');
          console.info('CSV data empty or not an array.');
          return;
        }
  
        // ✅ success: set your state here
        setCsvLoaded(true);
        setCsvError(null);
        setCsvRows(rows);
      })
      .catch(err => {
        console.error("Error loading CSV from proxy:", err);
        setCsvLoaded(false);
        setCsvError(err.message || String(err));
      });
  
    return () => { mounted = false; };
  }, []);
  

  // Submit handler
  const handleSubmit = async () => {
    // validation
    const validation = validateForm();
    if (!validation.isValid) {
      setSubmitStatus({ type: 'error', message: validation.message });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus({ type: '', message: '' });

    // prepare payload (ensure numeric fields are numbers)
    const submissionData = {
      ...formData,
      timestamp: new Date().toISOString(),
      totalBankEntries: parseInt(formData.totalBankEntries) || 0,
      totalTransactionsOthers: parseInt(formData.totalTransactionsOthers) || 0,
      totalEntries: parseInt(formData.totalEntries) || 0,
      estimatedDays: parseInt(formData.estimatedDays) || 0,
      noOfBankAccounts: parseInt(formData.noOfBankAccounts) || 0,
      bankTransaction1: parseInt(formData.bankTransaction1) || 0,
      bankTransaction2: parseInt(formData.bankTransaction2) || 0,
      bankTransaction3: parseInt(formData.bankTransaction3) || 0,
      bankTransaction4: parseInt(formData.bankTransaction4) || 0,
      bankTransaction5: parseInt(formData.bankTransaction5) || 0,
      bankTransaction6: parseInt(formData.bankTransaction6) || 0,
      noOfSaleInvoices: parseInt(formData.noOfSaleInvoices) || 0,
      noOfPINs: parseInt(formData.noOfPINs) || 0,
      noOfWages: parseInt(formData.noOfWages) || 0,
      fees: parseFloat(formData.fees) || 0
    };

    console.log('Submitting data to Google Sheets (via proxy):', submissionData);

    try {
      const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionData)
      });

      let result = null;
      try {
        result = await response.json();
      } catch (err) {
        console.warn('Could not parse proxy response as JSON', err);
      }

      const appsResp = result?.appsScriptResponse ?? result;

      if (appsResp && appsResp.success === true) {
        setSubmitStatus({ type: 'success', message: appsResp.message || 'Data successfully submitted to Google Sheets!' });
        // optionally reset or keep values
      } else if (response.ok && !appsResp) {
        setSubmitStatus({ type: 'success', message: 'Data submitted — check your spreadsheet.' });
      } else {
        const errMsg = (appsResp && (appsResp.message || appsResp.error)) || result?.error || `Submission failed: ${response.status}`;
        setSubmitStatus({ type: 'error', message: errMsg });
      }
    } catch (err) {
      console.error('Error submitting data:', err);
      setSubmitStatus({ type: 'error', message: 'Network error or proxy issue. See console & proxy logs.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ---------- Render UI (keeps your original style/fields) ---------- */
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom right, #9333ea, #2563eb, #4338ca)',
      padding: '24px'
    }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          marginBottom: '32px'
        }}>
          <div style={{
            background: 'linear-gradient(to right, #9333ea, #4338ca)',
            padding: '32px',
            color: 'white',
            textAlign: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <FileText style={{ width: '48px', height: '48px', marginRight: '16px' }} />
              <h1 style={{ fontSize: '36px', fontWeight: 'bold', margin: 0 }}>Bookkeeping Data Entry</h1>
            </div>
            <p style={{ fontSize: '20px', opacity: 0.9, margin: 0 }}>Complete form to add new bookkeeping record to Google Sheets</p>
          </div>

          {/* CSV Upload & Integration Status */}
          <div style={{
            backgroundColor: '#f8fafc',
            padding: '16px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Upload style={{ width: '20px', height: '20px', color: '#6366f1' }} />
              <div>
                <div style={{ fontWeight: 600 }}>CSV (backend) — Autocomplete</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {csvLoaded ? `Loaded (${companyNumbers.length} companies)` : `Not loaded: ${csvError || 'no CSV found'}`}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle style={{ width: 20, height: 20, color: '#059669' }} />
                <div style={{ fontWeight: 600, color: '#065f46' }}>Integration: Ready (proxy)</div>
              </div>
              <button onClick={() => setShowSetupInstructions(s => !s)} style={{
                marginLeft: '12px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#6366f1',
                color: 'white',
                fontSize: '12px',
                cursor: 'pointer'
              }}>
                <Settings style={{ width: '12px', height: '12px', marginRight: '6px' }} /> Setup
              </button>
            </div>
          </div>

          <div style={{ padding: '32px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
              gap: '32px'
            }}>

              {/* Company Information */}
              <div style={{
                background: 'linear-gradient(to bottom right, #fff7ed, #fed7aa)',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #fdba74'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                  <Database style={{ width: '24px', height: '24px', marginRight: '12px', color: '#ea580c' }} />
                  <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937', margin: 0 }}>Company Information *</h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <AutocompleteInput
                    name="companyNo"
                    value={formData.companyNo}
                    onChange={handleInputChange}
                    onSelect={handleCompanyNumberSelect}
                    suggestions={companyNumbers}
                    placeholder="Type to search company numbers..."
                    label="Company Number"
                  />

                  <AutocompleteInput
                    name="companyName"
                    value={formData.companyName}
                    onChange={handleInputChange}
                    suggestions={companyNames}
                    placeholder="Company name will auto-fill or type to search..."
                    label="Company Name"
                  />

                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Company UTR</label>
                    <input
                      type="text"
                      name="companyUTR"
                      value={formData.companyUTR}
                      onChange={handleInputChange}
                      placeholder="UTR will auto-fill or enter manually..."
                      style={{
                        width: '100%',
                        padding: '12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px'
                      }}
                    />
                  </div>

                  <AutocompleteInput
                    name="clientReference"
                    value={formData.clientReference}
                    onChange={handleInputChange}
                    suggestions={clientReferences}
                    placeholder="Client reference will auto-fill or type to search..."
                
                    label="Client Reference"
                  />
                </div>
              </div>

              {/* Basic Information */}
              <div style={{
                background: 'linear-gradient(to bottom right, #dbeafe, #e0e7ff)',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #bfdbfe'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                  <Users style={{ width: '24px', height: '24px', marginRight: '12px', color: '#2563eb' }} />
                  <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937', margin: 0 }}>Basic Information</h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Serial No. (Auto)</label>
                    <input
                      type="text"
                      name="sNo"
                      value={formData.sNo}
                      readOnly
                      style={{
                        width: '100%',
                        padding: '12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        backgroundColor: '#f9fafb',
                        color: '#6b7280'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Start Date</label>
                    <input type="date" name="startDateManual" value={formData.startDateManual} onChange={handleInputChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Bookkeeper Start Date</label>
                    <input type="date" name="bookkeeperStartDate" value={formData.bookkeeperStartDate} onChange={handleInputChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Estimated Days</label>
                    <input type="number" name="estimatedDays" value={formData.estimatedDays} onChange={handleInputChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Output Date</label>
                    <input type="date" name="outputDate" value={formData.outputDate} onChange={handleInputChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input type="checkbox" name="urgent" checked={formData.urgent} onChange={handleInputChange} style={{ width: '16px', height: '16px', marginRight: '12px' }} />
                    <label style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>Urgent</label>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Month (Auto)</label>
                    <input type="text" name="month" value={formData.month} readOnly style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', backgroundColor: '#f9fafb', color: '#6b7280' }} />
                  </div>
                </div>
              </div>

              {/* File Information */}
              <div style={{
                background: 'linear-gradient(to bottom right, #dcfce7, #d1fae5)',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #bbf7d0'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                  <FileText style={{ width: '24px', height: '24px', marginRight: '12px', color: '#059669' }} />
                  <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937', margin: 0 }}>File Information *</h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Responsible User</label>
                    <input type="text" name="responsibleUser" value={formData.responsibleUser} onChange={handleInputChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }} />
                  </div>

                  <AutocompleteInput
                    name="fileName"
                    value={formData.fileName}
                    onChange={handleInputChange}
                    suggestions={fileNames}
                    placeholder="Type to search file names..."
                    required
                    label="File Name"
                  />

                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>File Source</label>
                    <select name="fileSource" value={formData.fileSource} onChange={handleInputChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }}>
                    <option value="">Select file source</option>
    <option value="Allocation group">Allocation group</option>
    <option value="Google Chats">Google Chats</option>
    <option value="Google Chats, Task Sheet">Google Chats, Task Sheet</option>
                    </select>
                  </div>
                  <div>
  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>
    File Type
  </label>
  <select
    name="fileType"
    value={formData.fileType}
    onChange={handleInputChange}
    style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }}
    required
  >
    <option value="">Select File Type</option>
    <option value="VT">VT</option>
    <option value="Quick file">Quick file</option>
    <option value="Quick Books">Quick Books</option>
    <option value="Xero">Xero</option>
    <option value="Sage">Sage</option>
    <option value="Excel">Excel</option>
    <option value="Other">Other</option>
  </select>

  {formData.fileType === "Other" && (
    <input
      type="text"
      name="customFileType"
      value={formData.customFileType || ""}
      onChange={handleInputChange}
      placeholder="Enter custom file type"
      style={{
        marginTop: '12px',
        width: '100%',
        padding: '12px',
        border: '1px solid #d1d5db',
        borderRadius: '8px'
      }}
    />
  )}
</div>

</div>

<div>
  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Period</label>
  <input
    type="text"
    name="period"
    value={formData.period}
    onChange={handleInputChange}
    placeholder="e.g. Jan 2023 - Dec 2023"
    style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }}
  />
</div>

<div>
  <label style={{ display: 'block', marginBottom: 8 }}>Work Done</label>


                  <div>
                    <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 8 }}>Status</label>
                    <select name="status" value={formData.status} onChange={handleInputChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px' }}>
                    <option value="To-do, not taken up yet">To-do, not taken up yet</option>
    <option value="Currently Working">Currently Working</option>
    <option value="Under Review- UK">Under Review- UK</option>
    <option value="Under Review- India">Under Review- India</option>
    <option value="Queries sent to CA">Queries sent to CA</option>
    <option value="Completed">Completed</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>


{/* ---------- Assignment & Work (replace whole card) ---------- */}
<div style={{
  marginTop: '32px',
  background: 'linear-gradient(to bottom right, #fdf2f8, #fce7f3)',
  padding: '24px',
  borderRadius: '12px',
  border: '1px solid #f9a8d4'
}}>
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
    <Clock style={{ width: '24px', height: '24px', marginRight: '12px', color: '#a21caf' }} />
    <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937', margin: 0 }}>Assignment & Work</h3>
  </div>

  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
    <div style={{ flex: '1 1 300px' }}>
      <label style={{ display: 'block', marginBottom: 8 }}>File Allocated To</label>
      <input
        type="text"
        name="fileAllocatedTo"
        value={formData.fileAllocatedTo}
        onChange={handleInputChange}
        style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }}
      />
    </div>

    <div style={{ flex: '1 1 300px' }}>
      <AutocompleteInput
        name="bookkeeper"
        value={formData.bookkeeper}
        onChange={handleInputChange}
        suggestions={bookkeepers}
        placeholder="Type to search bookkeepers..."
        label="Bookkeeper"
      />
    </div>

    <div style={{ flex: '1 1 300px' }}>
      <AutocompleteInput
        name="reviewer"
        value={formData.reviewer}
        onChange={handleInputChange}
        suggestions={reviewers}
        placeholder="Type to search reviewers..."
        label="Reviewer"
      />
    </div>

    {/* Work Done - select with Other option */}
    <div style={{ width: '100%' }}>
      <label style={{ display: 'block', marginBottom: 8 }}>Work Done</label>

      <select
        name="workDone"
        value={formData.workDone}
        onChange={handleInputChange}
        style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }}
        required
      >
        <option value="">Select Work Done</option>
        <option value="Year End Accounts">Year End Accounts</option>
        <option value="VAT">VAT</option>
        <option value="Management Accounts">Management Accounts</option>
        <option value="Bookkeeping">Bookkeeping</option>
        <option value="Others- List Preparation">Others- List Preparation</option>
        <option value="Self Assessment">Self Assessment</option>
        <option value="PTR">PTR</option>
        <option value="Others- Bank Reconciliation">Others- Bank Reconciliation</option>
        <option value="Other">Other</option>
      </select>

      {formData.workDone === "Other" && (
        <input
          type="text"
          name="customWorkDone"
          value={formData.customWorkDone || ""}
          onChange={handleInputChange}
          placeholder="Enter custom work done"
          style={{
            marginTop: 12,
            width: '100%',
            padding: 12,
            borderRadius: 8,
            border: '1px solid #d1d5db'
          }}
        />
      )}
    </div>
  </div>
</div>
{/* ---------- End Assignment & Work ---------- */}

            {/* Bank Transactions */}
            <div style={{
              marginTop: '32px',
              background: 'linear-gradient(to bottom right, #fef2f2, #fed7d7)',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #fca5a5'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                <Database style={{ width: '24px', height: '24px', marginRight: '12px', color: '#dc2626' }} />
                <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937', margin: 0 }}>Bank Transactions</h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>No. of Bank Accounts</label>
                  <input type="number" name="noOfBankAccounts" value={formData.noOfBankAccounts} onChange={handleInputChange} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>

                {[1,2,3,4,5,6].map(num => (
                  <div key={num}>
                    <label style={{ display: 'block', marginBottom: 8 }}>Bank Transaction {num}</label>
                    <input type="number" name={`bankTransaction${num}`} value={formData[`bankTransaction${num}`]} onChange={handleInputChange} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                  </div>
                ))}

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>Total Bank Entries (Auto)</label>
                  <input type="number" name="totalBankEntries" readOnly value={formData.totalBankEntries} style={{ width: '100%', padding: 12, borderRadius: 8, backgroundColor: '#f9fafb', border: '1px solid #d1d5db' }} />
                </div>
              </div>
            </div>

            {/* Sales & Other Transactions */}
            <div style={{
              marginTop: '32px',
              background: 'linear-gradient(to bottom right, #fffbeb, #fef3c7)',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #fcd34d'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                <DollarSign style={{ width: '24px', height: '24px', marginRight: '12px', color: '#d97706' }} />
                <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937', margin: 0 }}>Sales & Other Transactions</h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>Preparing Sales List</label>
                  <input type="text" name="preparingSalesList" value={formData.preparingSalesList} onChange={handleInputChange} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>No. of Sale Invoices</label>
                  <input type="number" name="noOfSaleInvoices" value={formData.noOfSaleInvoices} onChange={handleInputChange} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>No. of PINs</label>
                  <input type="number" name="noOfPINs" value={formData.noOfPINs} onChange={handleInputChange} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>No. of Wages</label>
                  <input type="number" name="noOfWages" value={formData.noOfWages} onChange={handleInputChange} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>Total Transactions (Others) - Auto</label>
                  <input type="number" name="totalTransactionsOthers" readOnly value={formData.totalTransactionsOthers} style={{ width: '100%', padding: 12, borderRadius: 8, backgroundColor: '#f9fafb', border: '1px solid #d1d5db' }} />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>Total Entries (Auto)</label>
                  <input type="number" name="totalEntries" readOnly value={formData.totalEntries} style={{ width: '100%', padding: 12, borderRadius: 8, backgroundColor: '#f9fafb', border: '1px solid #d1d5db' }} />
                </div>
              </div>
            </div>

            {/* Additional Info */}
            <div style={{
              marginTop: '32px',
              background: 'linear-gradient(to bottom right, #f9fafb, #e5e7eb)',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #d1d5db'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                <FileText style={{ width: '24px', height: '24px', marginRight: '12px', color: '#6b7280' }} />
                <h3 style={{ fontSize: '20px', fontWeight: '600', color: '#1f2937', margin: 0 }}>Additional Information</h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>Notes</label>
                  <textarea name="notes" value={formData.notes} onChange={handleInputChange} rows={4} style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 8 }}>Fees</label>
                  <input type="number" name="fees" value={formData.fees} onChange={handleInputChange} step="0.01" placeholder="0.00" style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>
              </div>
            </div>

            {/* Submit */}
            <div style={{ marginTop: '32px', textAlign: 'center' }}>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  padding: '16px 32px',
                  borderRadius: '50px',
                  color: 'white',
                  fontWeight: '600',
                  fontSize: '18px',
                  border: 'none',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  background: isSubmitting
                    ? '#9ca3af'
                    : 'linear-gradient(to right, #9333ea, #4338ca)'
                }}
              >
                {isSubmitting ? 'Submitting to Google Sheets...' : 'Submit to Google Sheets'}
              </button>

              {submitStatus.message && (
                <div style={{
                  marginTop: '16px',
                  padding: '16px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: submitStatus.type === 'success' ? '#d1fae5' : '#fee2e2',
                  color: submitStatus.type === 'success' ? '#065f46' : '#991b1b',
                  border: submitStatus.type === 'success' ? '1px solid #10b981' : '1px solid #ef4444'
                }}>
                  {submitStatus.type === 'success' ? (
                    <CheckCircle style={{ width: '20px', height: '20px', marginRight: '8px' }} />
                  ) : (
                    <AlertCircle style={{ width: '20px', height: '20px', marginRight: '8px' }} />
                  )}
                  {submitStatus.message}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Setup Instructions */}
        {showSetupInstructions && (
          <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600' }}>Quick Setup Instructions</h3>
              <button onClick={() => setShowSetupInstructions(false)} style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: 'white', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 12 }}>
                <strong>Create Google Sheet</strong><br />
                • Create new sheet with headers matching the form field names.<br />
                • Example headers: sNo, month, clientReference, fileName, companyNo, companyName, companyUTR, bookkeeper, reviewer, totalEntries, fees, notes, etc.
              </div>

              <div style={{ marginBottom: 12 }}>
                <strong>Apps Script</strong><br />
                • In the Sheet: Extensions → Apps Script. Paste the Apps Script code you have (or ask me and I can provide it). Deploy as Web App (execute as: Me, who has access: Anyone).
              </div>

              <div>
                <strong>Proxy</strong><br />
                • Run proxy.cjs (we provided earlier). Put your Apps Script /exec URL in proxy.cjs APPS_SCRIPT_URL and restart the proxy. Proxy serves /api/csv-data (reads uploads/master.csv) and forwards /api/bookkeeping to Apps Script.
              </div>
            </div>
          </div>
        )}

        <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>Integration Status: {GOOGLE_APPS_SCRIPT_URL ? 'Using proxy -> Apps Script' : 'Not configured'}</div>
          <div style={{ fontSize: '12px', color: '#9ca3af' }}>CSV Autocomplete: {csvLoaded ? `Loaded (${companyNumbers.length} companies)` : 'Upload CSV on backend for suggestions'}</div>
        </div>
      </div>

      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default BookkeepingForm;
