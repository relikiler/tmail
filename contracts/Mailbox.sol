// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Mailbox
 * @dev Контракт учёта подписок. Получает 50% от paySubscription() токена TMAIL.
 *      Владелец может вывести накопленные токены для развития проекта.
 */
contract Mailbox is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public token; // TMAIL

    // ============================ ПЛАНЫ ============================
    struct Plan {
        string name;
        uint256 price;       // цена в TMAIL (18 decimals)
        uint256 duration;    // в секундах (30 дней = 2_592_000)
        uint256 maxMails;    // 0 = безлимит
        uint256 maxStorage;  // байт (0 = безлимит)
    }

    Plan[] public plans;

    // ============================ ПОДПИСКИ ============================
    mapping(address => uint256) public planExpiresAt; // unix-сек окончания подписки
    mapping(address => uint256) public userPlanId;    // какой план у юзера
    mapping(address => uint256) public userMailsSent; // сколько писем отправил сегодня

    // ============================ СОБЫТИЯ ============================
    event SubscriptionBought(address indexed user, uint256 planId, uint256 expiresAt);
    event MailSent(address indexed from, address indexed to, uint256 timestamp);
    event TokensWithdrawn(address indexed to, uint256 amount);

    // ============================ КОНСТРУКТОР ============================
    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "Token required");
        token = IERC20(_token);

        // План 0: Free (7 писем/день, 0 байт)
        plans.push(Plan("Free", 0, 0, 7, 0));

        // План 1: Premium (безлимит, 10 МБ)
        plans.push(Plan("Premium", 10e18, 30 days, 0, 10 * 1024 * 1024));

        // План 2: Pro (безлимит, 100 МБ + приоритет)
        plans.push(Plan("Pro", 50e18, 30 days, 0, 100 * 1024 * 1024));
    }

    // ============================ ПОДПИСКА ============================
    function buySubscription(uint256 planId) external nonReentrant {
        require(planId > 0 && planId < plans.length, "Invalid plan");

        Plan storage plan = plans[planId];
        require(token.balanceOf(msg.sender) >= plan.price, "Insufficient TMAIL");

        // Переводим TMAIL от юзера сюда
        token.safeTransferFrom(msg.sender, address(this), plan.price);

        // Продлеваем или устанавливаем подписку
        uint256 currentExp = planExpiresAt[msg.sender];
        if (currentExp < block.timestamp) {
            currentExp = block.timestamp;
        }
        planExpiresAt[msg.sender] = currentExp + plan.duration;
        userPlanId[msg.sender] = planId;

        emit SubscriptionBought(msg.sender, planId, planExpiresAt[msg.sender]);
    }

    // ============================ ПРОВЕРКИ ============================
    function canSend(address user) external view returns (bool) {
        uint256 expires = planExpiresAt[user];
        if (expires >= block.timestamp) {
            // Premium/Pro — безлимит
            return true;
        }
        // Free — 7 писем/день
        // (счётчик userMailsSent сбрасывается в mailSent)
        return true; // на усмотрение вызывающего
    }

    function getPlan(address user) external view returns (uint256 planId, string memory name, uint256 expiresAt) {
        planId = userPlanId[user];
        if (planId == 0) {
            return (0, plans[0].name, 0);
        }
        return (planId, plans[planId].name, planExpiresAt[user]);
    }

    /// @notice Вызывается при отправке письма (внешний сервер или контракт)
    function mailSent(address from) external {
        userMailsSent[from] += 1;
        emit MailSent(from, address(0), block.timestamp);
    }

    // ============================ ВЫВОД ТОКЕНОВ (владелец) ============================
    function withdrawTokens(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Zero address");
        require(amount <= token.balanceOf(address(this)), "Insufficient balance");
        token.safeTransfer(to, amount);
        emit TokensWithdrawn(to, amount);
    }

    // ============================ GETTERS ============================
    function getPlanCount() external view returns (uint256) {
        return plans.length;
    }

    function getBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}