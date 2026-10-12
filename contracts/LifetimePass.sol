// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TMAIL Lifetime Pass
 * @dev 390 вечных пассов на безлимитную зашифрованную почту TMAIL.
 *      - Единственный выпуск: 130 в год, 3 года (390 всего), после mint навсегда закрыт.
 *      - 300 — аукцион за POL (флор $80 в wei, настраивается), 90 — PR/подписчики (бесплатный mint владельцем).
 *      - Роялти 7.5% (ERC-2981) — владельцу контракта.
 *      - Почта может работать без сервера: тело в IPFS, доказательство в блокчейне Polygon.
 */
contract LifetimePass is ERC721, ERC721URIStorage, Ownable, ReentrancyGuard, IERC2981 {
    // ============================ КОНСТАНТЫ ============================
    uint256 public constant MAX_MINT = 390;              // всего за 3 года
    uint256 public constant PER_YEAR = 130;              // выпуск в год
    uint256 public constant YEARS = 3;
    uint256 public constant ROYALTY_BPS = 750;           // 7.5% = 750 базисных пунктов
    uint256 public constant ROYALTY_DENOM = 10000;

    // ============================ СОСТОЯНИЕ ============================
    uint256 public totalMinted;
    uint256 public publicSold;          // сколько продано за POL (для аукционов/покупки)
    uint256 public price;               // флор-цена в POL (wei), start 80 * 1e18
    string public baseTokenURI;

    // ============================ СОБЫТИЯ ============================
    event PassMinted(uint256 indexed tokenId, address indexed to, bool paid);
    event PriceUpdated(uint256 newPrice);
    event SupplyEnded();

    // ============================ КОНСТРУКТОР ============================
    constructor(string memory _baseTokenURI) ERC721("TMAIL Lifetime Pass", "TMAILPASS") Ownable(msg.sender) {
        baseTokenURI = _baseTokenURI;
        price = 80 * 10**18; // $80 в POL (wei) — флор
    }

    // ============================ МИНТ ============================

    /// @dev Годовая квота ещё не исчерпана?
    function yearQuotaLeft() public view returns (bool) {
        uint256 year = (totalMinted / PER_YEAR) + 1;
        return (year <= YEARS) && (totalMinted < year * PER_YEAR);
    }

    /// @dev Покупка пасса за POL (минт с оплатой, флор $80). Платит покупатель.
    function buyPass() external payable nonReentrant returns (uint256) {
        require(yearQuotaLeft(), "Supply for the period ended or max reached");
        require(publicSold < 300, "300 public passes sold");
        require(msg.value >= price, "Below floor price");

        uint256 tokenId = totalMinted++;
        publicSold++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, _uriForToken(tokenId));

        emit PassMinted(tokenId, msg.sender, true);
        return tokenId;
    }

    /// @dev Бесплатный минт владельцем (PR/подписчики/реклама) — максимум 90 шт.
    function mintReward(address to) external onlyOwner returns (uint256) {
        require(totalMinted < MAX_MINT, "Max reached");
        require(publicSold + rewardMinted() < 390, "All supply used");

        uint256 tokenId = totalMinted++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, _uriForToken(tokenId));

        emit PassMinted(tokenId, to, false);
        return tokenId;
    }

    function rewardMinted() public view returns (uint256) {
        return totalMinted - publicSold;
    }

    // ============================ МЕТАДАННЫЕ ============================

    function _uriForToken(uint256 tokenId) internal view returns (string memory) {
        // метаданные наподобие ipfs://QmXXXX/{tokenId}.json
        return string(abi.encodePacked(baseTokenURI, _toString(tokenId), ".json"));
    }

    // Приводим okenId к строке
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function setBaseTokenURI(string memory _baseTokenURI) external onlyOwner {
        baseTokenURI = _baseTokenURI;
    }

    function setPrice(uint256 _price) external onlyOwner {
        price = _price;
    }

    // ============================ РОЯЛТИ (ERC-2981) ============================
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount) {
        receiver = owner();
        royaltyAmount = (salePrice * ROYALTY_BPS) / ROYALTY_DENOM;
    }

    // ============================ ВЫВОД ПОЛ ============================
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    // ============================ ПЕРЕОПРЕДЕЛЕНИЯ ============================
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage, IERC165) returns (bool) {
        return super.supportsInterface(interfaceId) || interfaceId == type(IERC2981).interfaceId;
    }
}