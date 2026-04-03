-- ============================================
-- BagAI - Schema Supabase
-- Execute ce script dans l'editeur SQL de Supabase
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

-- Passengers
CREATE TABLE passengers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  auth_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin', 'supervisor')),
  airport_code TEXT NOT NULL,
  auth_user_id UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flights
CREATE TABLE flights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_number TEXT NOT NULL,
  airline TEXT NOT NULL,
  origin TEXT,
  destination TEXT NOT NULL,
  departure_date DATE NOT NULL,
  departure_time TIME NOT NULL,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'boarding', 'departed', 'arrived', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Luggage
CREATE TABLE luggage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_id UUID NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
  flight_id UUID NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  tracking_code TEXT NOT NULL UNIQUE,
  photo_url TEXT,
  description TEXT,
  brand TEXT,
  color TEXT,
  size TEXT CHECK (size IN ('cabin', 'medium', 'large', 'oversized')),
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'lost', 'found', 'matched', 'transferred', 'returned')),
  ai_fingerprint JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Loss reports
CREATE TABLE loss_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  luggage_id UUID REFERENCES luggage(id),
  flight_number TEXT,
  passenger_name TEXT,
  description TEXT NOT NULL,
  photo_url TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
  reported_by TEXT CHECK (reported_by IN ('passenger', 'agent')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Match results
CREATE TABLE match_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lost_luggage_id UUID NOT NULL REFERENCES luggage(id),
  found_photo_url TEXT,
  confidence_score NUMERIC(5,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  agent_id UUID REFERENCES agents(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  recommendation TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id UUID NOT NULL,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('agent', 'passenger')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('loss_report', 'match_found', 'transfer_success', 'status_update')),
  is_read BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity log
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID,
  actor_type TEXT CHECK (actor_type IN ('agent', 'passenger', 'system')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_luggage_tracking_code ON luggage(tracking_code);
CREATE INDEX idx_luggage_status ON luggage(status);
CREATE INDEX idx_luggage_passenger ON luggage(passenger_id);
CREATE INDEX idx_luggage_flight ON luggage(flight_id);
CREATE INDEX idx_flights_number ON flights(flight_number);
CREATE INDEX idx_flights_date ON flights(departure_date);
CREATE INDEX idx_match_results_status ON match_results(status);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read);
CREATE INDEX idx_loss_reports_status ON loss_reports(status);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Generate tracking code BAG-XXXXXX
CREATE OR REPLACE FUNCTION generate_tracking_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tracking_code IS NULL THEN
    NEW.tracking_code := 'BAG-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_tracking_code
  BEFORE INSERT ON luggage
  FOR EACH ROW
  EXECUTE FUNCTION generate_tracking_code();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_luggage_updated_at
  BEFORE UPDATE ON luggage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE passengers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE luggage ENABLE ROW LEVEL SECURITY;
ALTER TABLE flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE loss_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Passengers can see their own data
CREATE POLICY "Passengers see own data" ON passengers
  FOR SELECT USING (auth_user_id = auth.uid());

-- Agents can see all passengers
CREATE POLICY "Agents see all passengers" ON passengers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM agents WHERE auth_user_id = auth.uid())
  );

-- Anyone can insert passengers (registration)
CREATE POLICY "Anyone can register" ON passengers
  FOR INSERT WITH CHECK (TRUE);

-- Agents can see all luggage
CREATE POLICY "Agents see all luggage" ON luggage
  FOR ALL USING (
    EXISTS (SELECT 1 FROM agents WHERE auth_user_id = auth.uid())
  );

-- Passengers see own luggage
CREATE POLICY "Passengers see own luggage" ON luggage
  FOR SELECT USING (
    passenger_id IN (SELECT id FROM passengers WHERE auth_user_id = auth.uid())
  );

-- Public can insert luggage
CREATE POLICY "Anyone can register luggage" ON luggage
  FOR INSERT WITH CHECK (TRUE);

-- Flights are public read
CREATE POLICY "Flights are public" ON flights
  FOR SELECT USING (TRUE);

-- Agents manage flights
CREATE POLICY "Agents manage flights" ON flights
  FOR ALL USING (
    EXISTS (SELECT 1 FROM agents WHERE auth_user_id = auth.uid())
  );

-- Loss reports - anyone can create
CREATE POLICY "Anyone can report loss" ON loss_reports
  FOR INSERT WITH CHECK (TRUE);

-- Agents see all loss reports
CREATE POLICY "Agents see loss reports" ON loss_reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM agents WHERE auth_user_id = auth.uid())
  );

-- Match results - agents only
CREATE POLICY "Agents manage matches" ON match_results
  FOR ALL USING (
    EXISTS (SELECT 1 FROM agents WHERE auth_user_id = auth.uid())
  );

-- Notifications - own only
CREATE POLICY "Own notifications" ON notifications
  FOR SELECT USING (recipient_id IN (
    SELECT id FROM passengers WHERE auth_user_id = auth.uid()
    UNION
    SELECT id FROM agents WHERE auth_user_id = auth.uid()
  ));

-- ============================================
-- STORAGE BUCKET
-- ============================================
-- A creer manuellement dans Supabase Dashboard :
-- Bucket name: luggage-photos
-- Public: true
-- File size limit: 5MB
-- Allowed MIME types: image/jpeg, image/png, image/webp

-- ============================================
-- SEED DATA (donnees de test)
-- ============================================

-- Compagnies aeriennes de test
INSERT INTO flights (flight_number, airline, origin, destination, departure_date, departure_time, status) VALUES
  ('AT560', 'Royal Air Maroc', 'Paris CDG', 'Casablanca Mohamed V', '2026-03-24', '11:00', 'departed'),
  ('AT781', 'Royal Air Maroc', 'Casablanca Mohamed V', 'Marrakech', '2026-03-24', '14:30', 'departed'),
  ('AF230', 'Air France', 'Paris CDG', 'Casablanca Mohamed V', '2026-03-24', '09:00', 'departed'),
  ('RY104', 'Ryanair', 'Madrid', 'Casablanca Mohamed V', '2026-03-24', '16:00', 'scheduled');
