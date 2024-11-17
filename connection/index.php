<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Database configuration
$db_config = [
    'host' => 'srv1640.hstgr.io:3306',
    'user' => 'u788505671_api',
    'pass' => 'Shubham07@kb#api',
    'dbname' => 'u788505671_api'
];

// Connect to database
function connectDB() {
    global $db_config;
    try {
        $pdo = new PDO(
            "mysql:host={$db_config['host']};dbname={$db_config['dbname']}",
            $db_config['user'],
            $db_config['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        die(json_encode(['error' => 'Database connection failed']));
    }
}

// Generate random connection code
function generateCode($length = 6) {
    $characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    $code = '';
    for ($i = 0; $i < $length; $i++) {
        $code .= $characters[rand(0, strlen($characters) - 1)];
    }
    return $code;
}

// Clean expired connections
function cleanExpiredConnections($pdo) {
    $stmt = $pdo->prepare("DELETE FROM peer_connections WHERE expires_at < NOW()");
    $stmt->execute();
}

// Handle requests
$method = $_SERVER['REQUEST_METHOD'];
$pdo = connectDB();
cleanExpiredConnections($pdo);

$action = $_GET['action'] ?? $_POST['action'] ?? '';

if ($action === 'cron') {
    // Cron job to clean up expired connections
    cleanExpiredConnections($pdo);
    echo json_encode(['success' => true, 'message' => 'Expired connections deleted']);
    exit;
}

switch ($method) {
    case 'POST':
        $data = json_decode(file_get_contents('php://input'), true);
        $action = $data['action'] ?? '';

        switch ($action) {
            case 'create_connection':
                try {
                    $code = generateCode();
                    $senderId = $data['sender_id'];
                    $connectionData = json_encode($data['connection_data']); // Encode the connection data object

                    $stmt = $pdo->prepare("
                        INSERT INTO peer_connections 
                        (connection_code, sender_id, connection_data) 
                        VALUES (?, ?, ?)
                    ");
                    $stmt->execute([$code, $senderId, $connectionData]);

                    echo json_encode([
                        'success' => true,
                        'code' => $code
                    ]);
                } catch (Exception $e) {
                    http_response_code(500);
                    echo json_encode([
                        'error' => 'Failed to create connection'
                    ]);
                }
                break;
            case 'update_connection':
                try {
                    $code = $data['code'];
                    $connectionData = json_encode($data['connection_data']); // Encode the connection data object

                    $stmt = $pdo->prepare("
                        UPDATE peer_connections 
                        SET connection_data = ?, 
                            is_connected = TRUE 
                        WHERE connection_code = ? 
                        AND expires_at > NOW()
                    ");
                    $stmt->execute([$connectionData, $code]);

                    if ($stmt->rowCount() > 0) {
                        echo json_encode(['success' => true]);
                    } else {
                        http_response_code(404);
                        echo json_encode(['error' => 'Connection not found or expired']);
                    }
                } catch (Exception $e) {
                    http_response_code(500);
                    echo json_encode(['error' => 'Failed to update connection']);
                }
                break;
            default:
                http_response_code(400);
                echo json_encode(['error' => 'Invalid action']);
        }
        break;

    case 'GET':
        if ($action === 'delete' && isset($_GET['code'])) {
            // Delete a connection
            try {
                $code = $_GET['code'];
                $stmt = $pdo->prepare("DELETE FROM peer_connections WHERE connection_code = ?");
                $stmt->execute([$code]);

                echo json_encode(['success' => true, 'message' => 'Connection deleted']);
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to delete connection']);
            }
        } else if (isset($_GET['code'])) {
            // Get connection data
            try {
                $code = $_GET['code'];
                $stmt = $pdo->prepare("
                    SELECT connection_data, is_connected 
                    FROM peer_connections 
                    WHERE connection_code = ? 
                    AND expires_at > NOW()
                ");
                $stmt->execute([$code]);
                $result = $stmt->fetch(PDO::FETCH_ASSOC);

                if ($result) {
                    echo json_encode([
                        'success' => true,
                        'data' => $result
                    ]);
                } else {
                    http_response_code(404);
                    echo json_encode(['error' => 'Connection not found or expired']);
                }
            } catch (Exception $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to retrieve connection']);
            }
        } else {
            http_response_code(400);
            echo json_encode(['error' => 'Connection code required']);
        }
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}
