-- 1. Create semantic_adjudication_queue table
DROP TABLE IF EXISTS public.semantic_adjudication_queue CASCADE;

CREATE TABLE IF NOT EXISTS public.semantic_adjudication_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_finding_id UUID NOT NULL REFERENCES public.report_findings(id) ON DELETE CASCADE,
    candidate_group_id UUID,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'needs_review')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    decision TEXT,
    confidence TEXT,
    reason TEXT,
    model TEXT,
    policy_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(report_finding_id)
);

-- Index for queue polling
CREATE INDEX IF NOT EXISTS idx_semantic_queue_poll ON public.semantic_adjudication_queue (status, next_attempt_at, locked_at);

-- 2. Trigger for updated_at
DROP TRIGGER IF EXISTS update_semantic_queue_updated_at ON public.semantic_adjudication_queue;
CREATE TRIGGER update_semantic_queue_updated_at
    BEFORE UPDATE ON public.semantic_adjudication_queue
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- 3. RPC to claim items
CREATE OR REPLACE FUNCTION claim_semantic_queue_items(batch_limit INTEGER)
RETURNS SETOF public.semantic_adjudication_queue AS $$
BEGIN
    RETURN QUERY
    UPDATE public.semantic_adjudication_queue
    SET status = 'processing',
        locked_at = NOW(),
        attempts = attempts + 1
    WHERE id IN (
        SELECT id FROM public.semantic_adjudication_queue
        WHERE (status = 'pending' OR (status = 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())))
        -- Also pick up items that have been locked for more than 15 minutes (stuck/crashed)
        AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '15 minutes')
        ORDER BY created_at ASC
        LIMIT batch_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 4. RPC to safely apply the decision transaction
CREATE OR REPLACE FUNCTION apply_semantic_decision(
    p_queue_id UUID,
    p_decision TEXT,
    p_confidence TEXT,
    p_reason TEXT,
    p_model TEXT,
    p_policy_version TEXT,
    p_new_group_title TEXT DEFAULT NULL,
    p_new_group_norm_key TEXT DEFAULT NULL,
    p_new_group_entity TEXT DEFAULT NULL,
    p_new_group_defect TEXT DEFAULT NULL,
    p_new_group_domain TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_finding_id UUID;
    v_candidate_group_id UUID;
    v_new_group_id UUID;
BEGIN
    -- Get the queue item
    SELECT report_finding_id, candidate_group_id INTO v_finding_id, v_candidate_group_id
    FROM public.semantic_adjudication_queue
    WHERE id = p_queue_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Queue item not found';
    END IF;

    -- Apply based on decision
    IF p_decision = 'SAME_ISSUE' THEN
        IF v_candidate_group_id IS NULL THEN
            RAISE EXCEPTION 'candidate_group_id is NULL for SAME_ISSUE';
        END IF;
        
        -- Link the finding to the candidate group and remove pending_review
        UPDATE public.report_findings
        SET recurrence_group_id = v_candidate_group_id,
            review_status = 'approved'
        WHERE id = v_finding_id;
        
    ELSIF p_decision = 'DISTINCT' THEN
        -- Create a new recurrence group
        INSERT INTO public.recurrence_groups (
            title, normalized_key, entity, defect, domain, confidence, review_status, matching_policy_version
        ) VALUES (
            p_new_group_title, p_new_group_norm_key, p_new_group_entity, p_new_group_defect, p_new_group_domain, p_confidence, 'approved', p_policy_version
        ) RETURNING id INTO v_new_group_id;
        
        -- Link finding to the new group
        UPDATE public.report_findings
        SET recurrence_group_id = v_new_group_id,
            review_status = 'approved'
        WHERE id = v_finding_id;
        
    ELSIF p_decision = 'UNCERTAIN' THEN
        -- Keep finding in pending_review
        UPDATE public.report_findings
        SET review_status = 'pending_review'
        WHERE id = v_finding_id;
    END IF;

    -- Update the queue status
    UPDATE public.semantic_adjudication_queue
    SET status = CASE WHEN p_decision IN ('SAME_ISSUE', 'DISTINCT') THEN 'completed' ELSE 'needs_review' END,
        completed_at = NOW(),
        locked_at = NULL,
        decision = p_decision,
        confidence = p_confidence,
        reason = p_reason,
        model = p_model,
        policy_version = p_policy_version
    WHERE id = p_queue_id;
END;
$$ LANGUAGE plpgsql;
