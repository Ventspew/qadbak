CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    auth_service ENUM('ptc', 'google') NOT NULL DEFAULT 'ptc',
    username VARCHAR(255) NOT NULL,
    password VARCHAR(512) NOT NULL,
    level INT DEFAULT 0,
    experience BIGINT DEFAULT 0,
    team ENUM('unset', 'mystic', 'valor', 'instinct') DEFAULT 'unset',
    coins INT DEFAULT 0,
    stardust BIGINT DEFAULT 0,
    last_latitude DOUBLE DEFAULT NULL,
    last_longitude DOUBLE DEFAULT NULL,
    in_use TINYINT(1) NOT NULL DEFAULT 0,
    system_id VARCHAR(128) DEFAULT NULL,
    banned TINYINT(1) NOT NULL DEFAULT 0,
    shadowbanned TINYINT(1) NOT NULL DEFAULT 0,
    warning TINYINT(1) NOT NULL DEFAULT 0,
    captcha TINYINT(1) NOT NULL DEFAULT 0,
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY uq_auth (auth_service, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS account_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    detail JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    INDEX idx_account_events (account_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
