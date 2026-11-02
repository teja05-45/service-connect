-- Service Connect - seed data
--
-- Catalogue extracted from the project's original database dump.
-- Safe to re-run: rows are matched on the unique service name.

INSERT INTO services (name, description, icon_url) VALUES
    ('Electrician', 'Wiring, repair, and installation services.', '/images/electrician.png'),
    ('Plumber', 'Pipe fixing, drain cleaning, and fixture installation.', '/images/plumber.png'),
    ('Carpenter', 'Furniture assembly, custom builds, and wood repair.', '/images/carpenter.png'),
    ('Painter', 'Interior and exterior painting services.', '/images/painter.png'),
    ('AC/Refrigerator Repair', 'HVAC and major cooling appliance service.', '/images/ac.png'),
    ('Washing Machine Repair', 'Washer and dryer repair services.', '/images/washing-machine.png'),
    ('RO/Water Purifier Service', 'Maintenance and repair for water filtration systems.', '/images/water-purifier.png'),
    ('TV/Appliance Repair', 'General home appliance and TV repair.', '/images/tv.png'),
    ('Mason/Construction', 'Tiling, masonry, and minor construction work.', '/images/mason.png'),
    ('Pest Control', 'Insect and rodent extermination.', '/images/pest.png'),
    ('Home Cleaning & Sanitation', 'Deep cleaning, sanitization, and disinfection.', '/images/cleaning.png'),
    ('Beauty & Wellness', 'Salon, spa, and fitness services.', '/images/beauty.png')
ON CONFLICT (name) DO NOTHING;
