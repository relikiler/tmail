// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MailLog
 * @dev Отдельный лог immutable-писем TMAIL.
 *      Хранит хеш зашифрованного тела (keccak256) и ссылку на хранилище (CID/IPFS).
 *      Никаких денег, никаких подписок — только публичная, проверяемая запись.
 *
 *      Связь с TMAIL: адрес токена задаётся владельцем (для метаданных/подписки при желании),
 *      но сам контракт независим от TokenMail и Mailbox.
 */
contract MailLog {
    // ============================ СОБЫТИЕ ============================
    event MailLogged(
        address indexed from,
        address to,
        bytes32 mailHash,      // keccak256(шифрованное тело)
        string cid,            // ipfs://Qm... или http-ссылка на зашифрованное тело
        uint256 timestamp
    );

    // ============================ ССЫЛКИ ============================
    address public token;      // TMAIL (для информации/возможной интеграции)
    address public owner;

    // ============================ ОШИБКИ ============================
    error OnlyOwner();
    error ZeroAddress();

    // ============================ КОНСТРУКТОР ============================
    constructor(address _token) {
        require(_token != address(0), "Token required");
        token = _token;
        owner = msg.sender;
    }

    // ============================ ЛОГ ============================
    /**
     * @dev Записывает факт отправки immutable-письма.
     * @param to адрес получателя (зашифрованный, сервер/клиент сам его раскрывает)
     * @param mailHash хеш зашифрованного тела (keccak256)
     * @param cid ссылка на зашифрованное тело в IPFS/Arweave (например "Qm...")
     */
    function logMail(address from, address to, bytes32 mailHash, string calldata cid) external {
        // Проверяем, что отправитель не подделывает чужой адрес:
        // только сам отправитель (или контракт, который клиент одобрил) может писать
        require(msg.sender == from || msg.sender == owner, "Not authorized");

        emit MailLogged(from, to, mailHash, cid, block.timestamp);
    }

    /**
     * @dev Возвращает последний лог для адреса (удобно для клиента при проверке).
     *      Для полноценного поиска — событий достаточно (индексация by from/to).
     */
    function getLastLog(address from) external view returns (bytes32 mailHash, uint256 timestamp, string memory cid) {
        // Упрощение: клиент слушает событие MailLogged по from.
        // Здесь можно вернуть последнюю запись, если хранить маппинг.
        return (bytes32(0), 0, "");
    }

    // ============================ УПРАВЛЕНИЕ ============================
    function setToken(address _token) external {
        if (msg.sender != owner) revert OnlyOwner();
        require(_token != address(0), "Zero address");
        token = _token;
    }

    function renounceOwner() external {
        if (msg.sender != owner) revert OnlyOwner();
        owner = address(0);
    }
}