
-- Each consumer's read position per topic on the bus.
CREATE TABLE bus_offsets (
    consumer text NOT NULL,
    topic text NOT NULL,
    last_id bigint NOT NULL,
    PRIMARY KEY (consumer, topic)
);
