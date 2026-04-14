-- Run this SQL in your Supabase SQL Editor to create the session tables
-- These tables store presentation sessions persistently across server restarts

CREATE TABLE IF NOT EXISTS public.vpp_sessions (
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    control_token_hash TEXT,
    current_slide_index INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    metadata TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vpp_session_slides (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES public.vpp_sessions(id) ON DELETE CASCADE,
    slide_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    image TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, slide_index)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_vpp_sessions_id ON public.vpp_sessions(id);
CREATE INDEX IF NOT EXISTS idx_vpp_sessions_status ON public.vpp_sessions(status);
CREATE INDEX IF NOT EXISTS idx_vpp_session_slides_session ON public.vpp_session_slides(session_id);

-- Enable Row Level Security (optional - adjust based on your auth strategy)
-- ALTER TABLE public.vpp_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.vpp_session_slides ENABLE ROW LEVEL SECURITY;

-- For now, allow anonymous access to these tables (service role bypasses RLS anyway)
-- If you want to restrict access, create policies like:
-- CREATE POLICY "Service role full access" ON public.vpp_sessions TO service_role USING (true);

-- Grant permissions
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON public.vpp_sessions TO service_role;
GRANT ALL ON public.vpp_session_slides TO service_role;
