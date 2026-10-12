// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TokenMail (TMAIL)
 * @dev ERC-20 на Polygon с анти-кит защитой и подпиской.
 *
 * Токеномика:
 *  - Эмиссия: 1_000_000 TMAIL (18 decimals)
 *  - Анти-кит: макс. холдинг 55% от totalSupply
 *  - Лимит TX от пула: 5% от totalSupply за одну покупку
 *  - Подписка: paySubscription() -> 50% на mailbox, 50% burn
 */
contract TokenMail is ERC20, ERC20Burnable, Ownable {
    // ============================ КОНСТАНТЫ ============================
    uint256 public constant MAX_HOLDING_PCT = 55;   // макс. % эмиссии у одного кошелька
    uint256 public constant MAX_TX_PCT = 5;         // макс. % от эмиссии за одну TX
    uint256 public constant TOTAL_CAP = 1_000_000e18; // фикс. эмиссия

    // ============================ СОСТОЯНИЕ ============================
    address public lpPool;   // адрес пула ликвидности (исключён из лимита холдинга)
    address public mailbox;  // адрес почтового контракта (приём 50% подписки)

    // ============================ ОШИБКИ ============================
    error ExceedsHoldingLimit();
    error ExceedsTxLimit();
    error ZeroAddress();

    // ============================ СОБЫТИЯ ============================
    event LpPoolSet(address indexed pool);
    event MailboxSet(address indexed mailbox);
    event SubscriptionPaid(address indexed user, uint256 amountSent, uint256 amountBurned);

    // ============================ КОНСТРУКТОР ============================
    constructor(
        address _lpPool,
        address _mailbox
    ) ERC20("TokenMail", "TMAIL") Ownable(msg.sender) {
        require(_lpPool != address(0), "LP pool required");
        require(_mailbox != address(0), "Mailbox required");

        lpPool = _lpPool;
        mailbox = _mailbox;

        _mint(msg.sender, TOTAL_CAP);
    }

    // ============================ АНТИ-КИТ: _update ============================
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        // Пропускаем для минта/сжигания и переводов самому себе
        if (from == address(0) || to == address(0) || from == to) return;

        // 1. Лимит холдинга у кошелька (кроме пула, почты и владельца)
        if (to != lpPool && to != mailbox && to != owner()) {
            uint256 total = totalSupply();
            uint256 balanceAfter = balanceOf(to);
            if (balanceAfter != 0 && balanceAfter * 100 / total > MAX_HOLDING_PCT) {
                revert ExceedsHoldingLimit();
            }
        }

        // 2. Лимит одной транзакции из пула
        if (from == lpPool) {
            uint256 total = totalSupply();
            if (value > total * MAX_TX_PCT / 100) {
                revert ExceedsTxLimit();
            }
        }
    }

    // ============================ ПОДПИСКА (50/50) ============================
    /**
     * @dev Пользователь платит подписку токеном:
     *      - 50% уходит на mailbox (почтовый контракт/адрес)
     *      - 50% сжигается (burn -> дефляция)
     */
    function paySubscription(uint256 amount) external {
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");

        uint256 half = amount / 2;
        uint256 toMailbox = amount - half; // если amount нечётный, чуть больше идёт на mailbox

        _transfer(msg.sender, mailbox, toMailbox);
        _burn(msg.sender, half);

        emit SubscriptionPaid(msg.sender, toMailbox, half);
    }

    // ============================ УПРАВЛЕНИЕ ============================
    function setLpPool(address _lpPool) external onlyOwner {
        if (_lpPool == address(0)) revert ZeroAddress();
        lpPool = _lpPool;
        emit LpPoolSet(_lpPool);
    }

    function setMailbox(address _mailbox) external onlyOwner {
        if (_mailbox == address(0)) revert ZeroAddress();
        mailbox = _mailbox;
        emit MailboxSet(_mailbox);
    }

    // ============================ GETTERS ============================
    function getHoldingPct(address user) external view returns (uint256) {
        if (totalSupply() == 0) return 0;
        return balanceOf(user) * 100 / totalSupply();
    }
}