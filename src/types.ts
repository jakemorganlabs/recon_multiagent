/**
 * Core domain types shared across the deterministic layer.
 * These mirror the schemas but are kept lightweight for runtime use.
 */

export interface BriefSlot {
  slot_name: string;
  required: boolean;
  question: string;
  confidence_floor?: number;
}

export interface Brief {
  target: { name: string; website?: string };
  slots: BriefSlot[];
  seed_urls?: string[];
  depth?: number;
}

export interface EvidenceItem {
  evidence_id: string;
  query: string;
  source_url: string;
  page_title?: string;
  snippet: string;
  fetched_text?: string;
  content_hash: string;
  retrieval_rank?: number;
  fetched_at: string;
}

export interface Signal {
  signal_id: string;
  slot: string;
  status: 'filled' | 'insufficient_evidence' | 'abstain';
  value?: string;
  confidence?: number;
  rationale?: string;
  evidence_ids: string[];
}

export interface DossierClaim {
  text: string;
  signal_ids: string[];
  gap?: boolean;
}

export interface DossierSection {
  claims: DossierClaim[];
  summary?: string;
}

export interface Dossier {
  executive_summary?: string;
  sections: Record<string, DossierSection>;
  gaps?: { slot: string; reason: string }[];
  grounding_passed?: boolean;
}
