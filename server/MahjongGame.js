/**
 * Mahjong Server Engine (Professional Edition)
 * - 1ファイル内で「役判定」「点数計算」「手牌操作」「ターン管理」「AI」を完全にオブジェクト分離
 * - マジックナンバー排除、堅牢なエラーハンドリング
 */

const CONSTANTS = {
    TILES: [
        '1m','2m','3m','4m','5m','6m','7m','8m','9m',
        '1p','2p','3p','4p','5p','6p','7p','8p','9p',
        '1s','2s','3s','4s','5s','6s','7s','8s','9s',
        '1z','2z','3z','4z','5z','6z','7z'
    ],
    YAOCHU: ['1m','9m','1p','9p','1s','9s','1z','2z','3z','4z','5z','6z','7z'],
    WINDS: ['1z', '2z', '3z', '4z'],
    SANGEN: ['5z', '6z', '7z'],
    BASE_POINT: { MANGAN: 2000, HANEMAN: 3000, BAIMAN: 4000, SANBAIMAN: 6000, YAKUMAN: 8000 },
    COST: { RIICHI: 1000, HONBA: 300, TSUMO_HONBA: 100, RYUUKYOKU: 3000 }
};

function log(...args) {
    console.log('[MahjongGame]', ...args);
}

class MahjongGame {
    constructor(playerIds, room) {
        this.room = room;
        this.playerIds = playerIds;
        this.settings = room.settings;
        
        // 基本状態
        this.roundWind = '1z'; 
        this.kyoku = 1;        
        this.dealerIndex = 0;  
        this.honba = 0;        
        this.kyoutaku = 0;     
        this.points = {};
        
        let startPt = this.settings.startPoints || 25000;
        playerIds.forEach(id => { this.points[id] = startPt; });

        this.wall = [];
        this.deadWall = [];
        this.doraIndicators = [];
        this.uraDoraIndicators = [];
        this.kanCount = 0;
        this.kanPlayers = new Set();
        
        this.players = {};
        this.currentTurn = 0; 
        this.lastDiscardTile = null; 
        this.lastDiscardPlayer = null;
        
        this.phase = 'DRAW';
        this.actionResponses = {};
        this.waitingFor = [];
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 

        this.actionResolved = false;
        this.rinshan = false;
        this.chankanTile = null;
        this.isIppatsuValid = false;
        this.turnCount = 0;

        this._setupManagers();
        this.startRound();
    }

    _setupManagers() {
        const self = this;

        // ==========================================
        // 1. Turn Manager (ターン管理)
        // ==========================================
        this.turnManager = {
            getCurrent: () => self.playerIds[self.currentTurn],
            next: () => {
                self.currentTurn = (self.currentTurn + 1) % self.playerIds.length;
                return self.playerIds[self.currentTurn];
            },
            isCurrentPlayer: (id) => self.playerIds[self.currentTurn] === id
        };

        // ==========================================
        // 2. Score Calculator (点数計算)
        // ==========================================
        this.scoreCalculator = {
            calculateFu: (melds, pair, winTile, isTsumo, isMenzen, bakaze, jikaze, isPinfu, isChiitoitsu) => {
                if (isChiitoitsu) return 25;
                if (isPinfu) return isTsumo ? 20 : 30;
                
                let fu = 20; 
                if (isMenzen && !isTsumo) fu += 10; 
                else if (isTsumo) fu += 2; 

                let normWin = self.yakuEvaluator.helper.safeNormalize(winTile);
                if (!normWin) return fu;

                let wNum = parseInt(normWin[0]);
                if (pair === normWin) fu += 2; 
                else {
                    melds.forEach(m => {
                        if (m.type === 'shuntsu' && m.tiles.includes(normWin)) {
                            let nums = m.tiles.map(t => parseInt(t[0])).sort();
                            if (wNum === nums[1] || (nums[0] === 1 && wNum === 3) || (nums[2] === 9 && wNum === 7)) fu += 2; 
                        }
                    });
                }

                if (pair === bakaze) fu += 2;
                if (pair === jikaze) fu += 2;
                if (CONSTANTS.SANGEN.includes(pair)) fu += 2;

                melds.forEach(m => {
                    if (m.type === 'shuntsu') return;
                    let isYaochu = m.tile.match(/[19z]/);
                    let base = isYaochu ? 8 : 4;
                    let isMinku = (m.isOpen || (!isTsumo && m.tile === normWin)); 
                    if (m.type === 'kantsu') fu += (m.isOpen ? base * 4 : base * 8);
                    else fu += (isMinku ? base / 2 : base);
                });

                if (fu === 20 && !isTsumo && !isMenzen) fu = 30; 
                return Math.ceil(fu / 10) * 10;
            },
            calculate: (han, fu, isDealer, isTsumo) => {
                let basePoint = 0;
                if (han >= 13) basePoint = CONSTANTS.BASE_POINT.YAKUMAN * Math.floor(han / 13); 
                else if (han >= 11) basePoint = CONSTANTS.BASE_POINT.SANBAIMAN;
                else if (han >= 8) basePoint = CONSTANTS.BASE_POINT.BAIMAN;
                else if (han >= 6) basePoint = CONSTANTS.BASE_POINT.HANEMAN;
                else {
                    basePoint = fu * Math.pow(2, han + 2);
                    if (basePoint >= CONSTANTS.BASE_POINT.MANGAN || han >= 5) basePoint = CONSTANTS.BASE_POINT.MANGAN; 
                }

                let point = { total: 0, dealerPay: 0, nonDealerPay: 0, isTsumo: isTsumo };
                if (isTsumo) {
                    if (isDealer) {
                        let pay = Math.ceil((basePoint * 2) / 100) * 100;
                        point.total = pay * 3;
                        point.nonDealerPay = pay;
                    } else {
                        let dPay = Math.ceil((basePoint * 2) / 100) * 100;
                        let nPay = Math.ceil(basePoint / 100) * 100;
                        point.total = dPay + nPay * 2;
                        point.dealerPay = dPay;
                        point.nonDealerPay = nPay;
                    }
                } else {
                    point.total = Math.ceil((basePoint * (isDealer ? 6 : 4)) / 100) * 100;
                }
                return point;
            }
        };

        // ==========================================
        // 3. Yaku Evaluator (役判定エンジン)
        // ==========================================
        this.yakuEvaluator = {
            helper: {
                winningTilesCache: new Map(),
                safeNormalize: (t) => {
                    try {
                        if (!t || typeof t !== 'string') return null;
                        return t[0] === '0' ? '5' + t[1] : t;
                    } catch { return null; }
                },
                countTiles: (tiles) => {
                    const counts = {};
                    tiles.forEach(t => {
                        let n = self.yakuEvaluator.helper.safeNormalize(t);
                        if (n) counts[n] = (counts[n] || 0) + 1;
                    });
                    return counts;
                },
                getAllMeldPatterns: (counts, currentMelds = []) => {
                    let patterns = [];
                    const search = (curCounts, melds, hasPair) => {
                        let keys = Object.keys(curCounts).filter(k => curCounts[k] > 0).sort();
                        if (keys.length === 0) {
                            if (melds.length === 4 && hasPair) patterns.push({ melds: [...melds], pair: hasPair });
                            return;
                        }
                        let first = keys[0];
                        if (!hasPair && curCounts[first] >= 2) {
                            let next = { ...curCounts }; next[first] -= 2; search(next, melds, first);
                        }
                        if (curCounts[first] >= 3) {
                            let next = { ...curCounts }; next[first] -= 3;
                            melds.push({ type: 'koutsu', tile: first }); search(next, melds, hasPair); melds.pop();
                        }
                        let num = parseInt(first[0]); let suit = first[1];
                        if (suit !== 'z' && num <= 7) {
                            let t2 = (num + 1) + suit; let t3 = (num + 2) + suit;
                            if (curCounts[t2] > 0 && curCounts[t3] > 0) {
                                let next = { ...curCounts }; next[first]--; next[t2]--; next[t3]--;
                                melds.push({ type: 'shuntsu', tiles: [first, t2, t3] }); search(next, melds, hasPair); melds.pop();
                            }
                        }
                    };
                    search({ ...counts }, [...currentMelds], null);
                    return patterns;
                },
                getDoraTile: (indicator) => {
                    const norm = self.yakuEvaluator.helper.safeNormalize(indicator);
                    if(!norm) return null;
                    const suit = norm[1]; const num = parseInt(norm[0]);
                    if (suit === 'z') {
                        if (num <= 4) return (num % 4 + 1) + 'z'; 
                        return ((num - 5 + 1) % 3 + 5) + 'z'; 
                    }
                    return (num % 9 + 1) + suit;
                },
                countDora: (allTilesRaw, doraIndicators = [], uraDoraIndicators = [], isRiichi) => {
                    let count = 0;
                    let activeIndicators = [...doraIndicators];
                    if (isRiichi) activeIndicators.push(...uraDoraIndicators);
                    
                    let doras = activeIndicators.map(ind => self.yakuEvaluator.helper.getDoraTile(ind)).filter(d=>d);
                    allTilesRaw.forEach(t => {
                        if (t && t[0] === '0') count++; 
                        let norm = self.yakuEvaluator.helper.safeNormalize(t);
                        if(norm) doras.forEach(d => { if (norm === d) count++; });
                    });
                    return count;
                }
            },
            special: {
                isChiitoitsu: (counts) => Object.keys(counts).filter(k => counts[k] === 2).length === 7,
                isKokushi: (counts) => {
                    let hasPair = false;
                    for (let y of CONSTANTS.YAOCHU) {
                        if (!counts[y]) return false;
                        if (counts[y] >= 2) hasPair = true;
                    }
                    return hasPair;
                }
            },
            standard: {
                isPinfu: (melds, pair, bakaze, jikaze, isMenzen, winTile) => {
                    if (!isMenzen) return false;
                    let shuntsu = melds.filter(m => m.type === 'shuntsu');
                    if (shuntsu.length !== 4) return false;
                    if (CONSTANTS.SANGEN.includes(pair) || [bakaze, jikaze].includes(pair)) return false;

                    let normWin = self.yakuEvaluator.helper.safeNormalize(winTile);
                    if (!normWin) return false;

                    return shuntsu.some(s => {
                        if (!s.tiles.includes(normWin)) return false;
                        let nums = s.tiles.map(t => parseInt(t[0])).sort((a,b)=>a-b);
                        let w = parseInt(normWin[0]);
                        if (!(nums[0]+1 === nums[1] && nums[1]+1 === nums[2])) return false;
                        if (w === nums[1]) return false; 
                        if (nums[0] === 1 && w === 3) return false; 
                        if (nums[2] === 9 && w === 7) return false; 
                        return true;
                    });
                },
                evaluateStandard: (handRaw, declaredMelds, stateObj, counts, allTilesRaw, handNorm, winTile, isMenzen) => {
                    let { isTsumo, isRiichi, isDoubleRiichi, isIppatsu, isRinshan, isChankan, isHoutei, isHaitei, bakaze, jikaze } = stateObj;
                    let normDeclaredMelds = declaredMelds.map(m => ({ ...m, tile: self.yakuEvaluator.helper.safeNormalize(m.tile), tiles: m.tiles?.map(t => self.yakuEvaluator.helper.safeNormalize(t)) }));
                    
                    let patterns = self.yakuEvaluator.helper.getAllMeldPatterns(counts, normDeclaredMelds);
                    let maxPointTotal = -1; let bestResultObj = null;

                    for (let pat of patterns) {
                        let han = 0; let yaku = []; let { melds, pair } = pat;

                        let yakumanList = [];
                        let koutsu = melds.filter(m => m.type === 'koutsu' || m.type === 'kantsu');
                        let closedKoutsuCount = koutsu.length - normDeclaredMelds.filter(m => m.isOpen).length;
                        if (!isTsumo && koutsu.some(m => m.tile === winTile)) closedKoutsuCount--;
                        
                        if (closedKoutsuCount === 4) yakumanList.push(pair === winTile ? '四暗刻単騎' : '四暗刻');
                        if (koutsu.some(m=>m.tile==='5z') && koutsu.some(m=>m.tile==='6z') && koutsu.some(m=>m.tile==='7z')) yakumanList.push('大三元');
                        if (handNorm.every(t => t.match(/z/))) yakumanList.push('字一色');
                        if (handNorm.every(t => t.match(/[19]/))) yakumanList.push('清老頭');
                        
                        let windsMelds = koutsu.filter(m => CONSTANTS.WINDS.includes(m.tile)).length;
                        let windsCount = windsMelds + (CONSTANTS.WINDS.includes(pair) ? 1 : 0);
                        if (windsMelds === 4) yakumanList.push('大四喜'); 
                        else if (windsCount === 4 && windsMelds === 3) yakumanList.push('小四喜');

                        if (yakumanList.length > 0) {
                            let yHan = yakumanList.length * 13;
                            if (yakumanList.includes('四暗刻単騎') || yakumanList.includes('大四喜')) yHan += 13;
                            return { han: yHan, yaku: yakumanList, fu: 20 };
                        }

                        if (isDoubleRiichi && isMenzen) { han += 2; yaku.push('ダブル立直'); }
                        else if (isRiichi && isMenzen) { han++; yaku.push('立直'); }
                        
                        if (isIppatsu) { han++; yaku.push('一発'); }
                        if (isTsumo && isMenzen) { han++; yaku.push('門前清自摸和'); }
                        if (isTsumo && isRinshan) { han++; yaku.push('嶺上開花'); }
                        if (!isTsumo && isChankan) { han++; yaku.push('槍槓'); }
                        if (isHaitei) { han++; yaku.push('海底摸月'); }
                        if (isHoutei) { han++; yaku.push('河底撈魚'); }
                        
                        if (!handNorm.some(t => t.match(/[19z]/))) { han++; yaku.push('タンヤオ'); }
                        
                        let yakuhaiSet = new Set();
                        melds.forEach(m => {
                            if (m.type === 'koutsu' || m.type === 'kantsu') {
                                if (m.tile === '5z') yakuhaiSet.add('白');
                                if (m.tile === '6z') yakuhaiSet.add('發');
                                if (m.tile === '7z') yakuhaiSet.add('中');
                                if (m.tile === bakaze) yakuhaiSet.add('場風');
                                if (m.tile === jikaze) yakuhaiSet.add('自風');
                            }
                        });
                        if (yakuhaiSet.size > 0) { yaku.push(...yakuhaiSet); han += yakuhaiSet.size; }

                        let isPin = self.yakuEvaluator.standard.isPinfu(melds, pair, bakaze, jikaze, isMenzen, winTile);
                        if (isPin) { han++; yaku.push('平和'); }
                        
                        let shuntsuStr = melds.filter(m => m.type === 'shuntsu').map(s => s.tiles.join('')).sort();
                        let iipeiko = 0;
                        for(let i=0; i<shuntsuStr.length-1; i++) {
                            if(shuntsuStr[i] === shuntsuStr[i+1]) { iipeiko++; i++; }
                        }
                        if (isMenzen && iipeiko === 1) { han++; yaku.push('一盃口'); }
                        else if (isMenzen && iipeiko === 2) { han+=3; yaku.push('二盃口'); }

                        if (koutsu.length === 4) { han+=2; yaku.push('対々和'); }
                        
                        let honroutou = handNorm.every(t => t.match(/[19z]/));
                        let chanta = melds.every(m => (m.type === 'koutsu' || m.type === 'kantsu') ? m.tile.match(/[19z]/) : m.tiles.some(t => t.match(/[19]/))) && pair.match(/[19z]/);
                        let hasZ = handNorm.some(t => t.match(/z/));
                        
                        if (honroutou) {
                            han += 2; yaku.push('混老頭');
                        } else if (chanta) {
                            if (!hasZ) { han += (isMenzen?3:2); yaku.push('純全帯幺九'); }
                            else { han += (isMenzen?2:1); yaku.push('混全帯幺九'); }
                        }

                        let suits = new Set(handNorm.filter(t => !t.match(/z/)).map(t => t[1]));
                        if (suits.size === 1) {
                            if (hasZ) { han += (isMenzen?3:2); yaku.push('混一色'); }
                            else { han += (isMenzen?6:5); yaku.push('清一色'); }
                        }

                        if (han > 0) { 
                            let fu = self.scoreCalculator.calculateFu(melds, pair, winTile, isTsumo, isMenzen, bakaze, jikaze, isPin, false);
                            let tempPoint = self.scoreCalculator.calculate(han, fu, bakaze === jikaze, isTsumo);
                            if (tempPoint.total > maxPointTotal || (tempPoint.total === maxPointTotal && han > (bestResultObj ? bestResultObj.han : 0))) {
                                maxPointTotal = tempPoint.total;
                                bestResultObj = { han, fu, yaku };
                            }
                        }
                    }
                    return bestResultObj;
                }
            },
            evaluate: (handRaw, declaredMelds, stateObj) => {
                let { winTileRaw, isTsumo, isRiichi, isDoubleRiichi, isIppatsu, isRinshan, isHaitei, isHoutei, isTenhou, isChiihou, bakaze, jikaze, doraIndicators, uraDoraIndicators } = stateObj;
                let isMenzen = declaredMelds.filter(m => m.isOpen).length === 0;

                let allTilesRaw = [...handRaw];
                if (!isTsumo && winTileRaw) allTilesRaw.push(winTileRaw);
                declaredMelds.forEach(m => { 
                    if (m.type === 'koutsu') allTilesRaw.push(m.tile, m.tile, m.tile);
                    if (m.type === 'kantsu') allTilesRaw.push(m.tile, m.tile, m.tile, m.tile); 
                });

                let handNorm = handRaw.map(t => self.yakuEvaluator.helper.safeNormalize(t));
                let winTile = self.yakuEvaluator.helper.safeNormalize(winTileRaw);
                if (!isTsumo && winTile) handNorm.push(winTile);

                let counts = self.yakuEvaluator.helper.countTiles(handRaw);
                if (!isTsumo && winTile) counts[winTile] = (counts[winTile] || 0) + 1;

                let startYakuman = [];
                if (isTenhou) startYakuman.push('天和');
                if (isChiihou) startYakuman.push('地和');

                let result = null;

                if (isMenzen && handNorm.length === 14) {
                    if (self.yakuEvaluator.special.isKokushi(counts)) {
                        let han = 13 + (startYakuman.length * 13); 
                        let yaku = counts[winTile] === 2 ? ['国士無双十三面待ち'] : ['国士無双'];
                        if (isTsumo && startYakuman.length === 0) yaku.push('門前清自摸和');
                        yaku.push(...startYakuman);
                        result = { han, yaku, fu: 20 };
                    } else if (self.yakuEvaluator.special.isChiitoitsu(counts)) {
                        let han = 2; let yaku = ['七対子'];
                        if (!handNorm.some(t => t.match(/[19z]/))) { han++; yaku.push('タンヤオ'); }
                        if (isDoubleRiichi) { han+=2; yaku.push('ダブル立直'); } else if (isRiichi) { han++; yaku.push('立直'); }
                        if (isIppatsu) { han++; yaku.push('一発'); }
                        if (isTsumo) { han++; yaku.push('門前清自摸和'); }
                        
                        let hasZ = handNorm.some(t => t.match(/z/));
                        let suits = new Set(handNorm.filter(t => !t.match(/z/)).map(t => t[1]));
                        if (suits.size === 1) {
                            if (hasZ) { han+=3; yaku.push('混一色'); }
                            else { han+=6; yaku.push('清一色'); }
                        }
                        result = { han, yaku, fu: 25 };
                    }
                }

                let standardResult = self.yakuEvaluator.standard.evaluateStandard(handRaw, declaredMelds, stateObj, counts, allTilesRaw, handNorm, winTile, isMenzen);
                if (standardResult && (!result || standardResult.han > result.han)) {
                    result = standardResult;
                }

                if (result && result.han > 0) {
                    let doraHan = self.yakuEvaluator.helper.countDora(allTilesRaw, doraIndicators, uraDoraIndicators, isRiichi || isDoubleRiichi);
                    if (doraHan > 0 && result.han < 13) {
                        result.han += doraHan;
                        result.yaku.push(`ドラ${doraHan}`);
                    }
                    result.point = self.scoreCalculator.calculate(result.han, result.fu, bakaze === jikaze, isTsumo);
                    return result;
                }
                return null;
            }
        };

        // ==========================================
        // 4. Hand Manager (手牌操作)
        // ==========================================
        this.handManager = {
            draw: (playerId) => {
                if (self.wall.length === 0) return false;
                self.players[playerId].hand.push(self.wall.pop());
                self.players[playerId].tempFuriten = false;
                return true;
            },
            drawRinshan: (playerId) => {
                self.kanPlayers.add(playerId);
                if (self.kanCount === 4 && self.kanPlayers.size > 1) return false; 
                if (self.kanCount < 4) {
                    self.players[playerId].hand.push(self.deadWall.pop());
                    self.doraIndicators.push(self.deadWall[self.kanCount * 2 + 2]);
                    self.uraDoraIndicators.push(self.deadWall[self.kanCount * 2 + 3]);
                    self.kanCount++;
                    self.wall.pop(); 
                    return true;
                }
                return false;
            },
            discard: (playerId, tileIndex) => {
                if (!playerId || typeof playerId !== 'string') throw new Error('Invalid playerId');
                if (tileIndex < 0 || tileIndex >= self.players[playerId].hand.length) throw new Error('Invalid index');
                const tile = self.players[playerId].hand.splice(tileIndex, 1)[0];
                if (!tile || typeof tile !== 'string') throw new Error('Invalid tile');
                self.players[playerId].discards.push(tile);
                self.players[playerId].firstTurn = false;
                return tile;
            }
        };

        // ==========================================
        // 5. AI Engine (思考)
        // ==========================================
        this.ai = {
            chooseDiscard: (playerId, level) => {
                let p = self.players[playerId];
                if (level === 'easy') return { type: 'DISCARD', payload: { tileIndex: p.hand.length - 1 } };

                let stateTemplate = { isRiichi: true, bakaze: self.roundWind, jikaze: CONSTANTS.WINDS[(self.playerIds.indexOf(playerId) - self.dealerIndex + 4) % 4] };
                let reachable = [];
                for (let i = 0; i < p.hand.length; i++) {
                    let testHand = [...p.hand]; testHand.splice(i, 1);
                    let winning = self.getWinningTiles(playerId, testHand);
                    if (winning.length > 0) reachable.push({ index: i, tile: p.hand[i], winningTiles: winning });
                }

                if (reachable.length > 0) {
                    reachable.sort((a, b) => b.winningTiles.length - a.winningTiles.length);
                    if (reachable[0].winningTiles.length >= 4 || self.points[playerId] >= 1000) return { type: 'RIICHI' }; 
                    return { type: 'DISCARD', payload: { tileIndex: reachable[0].index } };
                }

                let hand = p.hand;
                let tileCounts = self.yakuEvaluator.helper.countTiles(hand);
                let bestIndex = hand.length - 1;
                let maxScore = -9999;
                
                let safeTiles = new Set();
                let isSomeoneRiichi = false;
                self.playerIds.forEach(id => {
                    if (id !== playerId && self.players[id].riichi) {
                        isSomeoneRiichi = true;
                        self.players[id].discards.forEach(d => safeTiles.add(self.yakuEvaluator.helper.safeNormalize(d)));
                    }
                });

                for (let i = 0; i < hand.length; i++) {
                    let tile = hand[i];
                    let norm = self.yakuEvaluator.helper.safeNormalize(tile);
                    let score = 0; 
                    let suit = norm[1]; let num = parseInt(norm[0]);

                    if (tileCounts[norm] >= 2) score -= 20; 
                    else {
                        if (suit !== 'z') {
                            let tPrev = (num - 1) + suit; let tNext = (num + 1) + suit;
                            let tPrev2 = (num - 2) + suit; let tNext2 = (num + 2) + suit;
                            if (tileCounts[tPrev] || tileCounts[tNext]) score -= 10; 
                            if (tileCounts[tPrev2] || tileCounts[tNext2]) score -= 5; 
                            if (num === 1 || num === 9) score += 5; 
                        } else score += 15; 
                    }

                    let isDora = self.doraIndicators.map(ind => self.yakuEvaluator.helper.getDoraTile(ind)).includes(norm);
                    if (isDora) score -= 30; 
                    
                    if (isSomeoneRiichi) {
                        if (safeTiles.has(norm)) score += 100; 
                        else if (suit !== 'z') score -= 50; 
                    }

                    if (score > maxScore) { maxScore = score; bestIndex = i; }
                }
                return { type: 'DISCARD', payload: { tileIndex: bestIndex } };
            }
        };
    }

    startRound() {
        log(`Round Start: ${this.roundWind} ${this.kyoku} Kyoku, Honba: ${this.honba}`);
        
        const tiles = [];
        for (let suit of ['m', 'p', 's']) {
            for (let i = 1; i <= 9; i++) { for(let j=0; j<4; j++) tiles.push(i + suit); }
        }
        for (let i = 1; i <= 7; i++) { for(let j=0; j<4; j++) tiles.push(i + 'z'); }
        
        if (this.settings.akaDora > 0) {
            let akaCount = this.settings.akaDora;
            let m5Idx = tiles.indexOf('5m'); if (m5Idx !== -1 && akaCount >= 1) tiles[m5Idx] = '0m';
            let p5Idx = tiles.indexOf('5p'); if (p5Idx !== -1 && akaCount >= 2) tiles[p5Idx] = '0p';
            let s5Idx = tiles.indexOf('5s'); if (s5Idx !== -1 && akaCount >= 3) tiles[s5Idx] = '0s';
            if (akaCount === 4) { let p5Idx2 = tiles.lastIndexOf('5p'); if (p5Idx2 !== -1) tiles[p5Idx2] = '0p'; }
        }
        this.wall = tiles.sort(() => Math.random() - 0.5);

        this.deadWall = this.wall.splice(0, 14);
        this.doraIndicators = [this.deadWall[0]];
        this.uraDoraIndicators = [this.deadWall[1]];
        this.kanCount = 0;
        this.kanPlayers.clear();
        
        this.players = {};
        this.playerIds.forEach(id => {
            this.players[id] = { 
                hand: [], discards: [], melds: [], 
                riichi: false, doubleRiichi: false, openHand: false,
                tempFuriten: false, riichiFuriten: false, firstTurn: true 
            };
        });
        
        this.currentTurn = this.dealerIndex; 
        this.lastDiscardTile = null; 
        this.lastDiscardPlayer = null;
        
        this.phase = 'DRAW';
        this.actionResponses = {};
        this.waitingFor = [];
        this.winner = null;
        this.winningType = null; 
        this.winningYaku = null; 

        this.actionResolved = false;
        this.rinshan = false;
        this.chankanTile = null;
        this.isIppatsuValid = false;
        this.turnCount = 0;

        this.yakuEvaluator.helper.winningTilesCache.clear();

        this.playerIds.forEach(id => {
            for (let i = 0; i < 13; i++) { this.players[id].hand.push(this.wall.pop()); }
        });
        
        this.handManager.draw(this.turnManager.getCurrent());
        this.room.broadcastState();
        this.triggerAILogic(this.turnManager.getCurrent());
    }

    nextRound(isDealerWin, isDealerTenpai) {
        if (this.settings.length === 'east' && this.roundWind === '2z' && this.kyoku === 1) {
            this.room.endGame(); return;
        }
        if (isDealerWin || (this.winningType === 'RYUUKYOKU' && isDealerTenpai)) {
            this.honba++; 
        } else {
            this.dealerIndex = (this.dealerIndex + 1) % this.playerIds.length;
            this.kyoku++;
            if (this.winningType !== 'RYUUKYOKU') this.honba = 0; 
            else this.honba++;
            
            if (this.kyoku > this.playerIds.length) {
                this.kyoku = 1;
                let wIdx = CONSTANTS.WINDS.indexOf(this.roundWind);
                this.roundWind = CONSTANTS.WINDS[(wIdx + 1) % 4];
            }
        }
        this.startRound();
    }

    handleRyuukyoku(reason = '荒牌平局') {
        log(`Ryuukyoku: ${reason}`);
        this.phase = 'FINISHED';
        this.winningType = 'RYUUKYOKU';
        
        let resultMsg = [reason];
        let isDealerTenpai = false;

        this.winner = ['流局'];
        if (reason === '荒牌平局') {
            let tenpaiPlayers = []; let notenPlayers = [];
            this.playerIds.forEach(id => {
                if (this.isTenpai(id)) {
                    tenpaiPlayers.push(id);
                    if (this.playerIds.indexOf(id) === this.dealerIndex) isDealerTenpai = true;
                } else notenPlayers.push(id);
                this.players[id].openHand = true; 
            });

            if (tenpaiPlayers.length === 0) resultMsg.push("全員ノーテン");
            else if (tenpaiPlayers.length === this.playerIds.length) resultMsg.push("全員聴牌");
            else {
                resultMsg.push(`聴牌: ${tenpaiPlayers.join(', ')}`);
                let pay = CONSTANTS.COST.RYUUKYOKU / notenPlayers.length; 
                let get = CONSTANTS.COST.RYUUKYOKU / tenpaiPlayers.length;
                tenpaiPlayers.forEach(id => this.points[id] += get);
                notenPlayers.forEach(id => this.points[id] -= pay);
                resultMsg.push(`罰符: 聴牌+${get} / ノーテン-${pay}`);
            }
        } else {
            isDealerTenpai = true; 
            this.playerIds.forEach(id => this.players[id].openHand = true);
        }

        this.winningYaku = [{ han: 0, fu: 0, point: { total: 0, isTsumo: false }, yaku: resultMsg }];
        this.room.broadcastState();
        setTimeout(() => this.nextRound(false, isDealerTenpai), 7000);
    }

    checkWin(playerId, winTile, isTsumo, isChankan = false) {
        let player = this.players[playerId];
        let actualWinTile = winTile || player.hand[player.hand.length - 1];
        let playerIndex = this.playerIds.indexOf(playerId);
        
        let stateObj = {
            winTileRaw: actualWinTile, isTsumo: isTsumo, isRiichi: player.riichi, isDoubleRiichi: player.doubleRiichi,
            isIppatsu: player.riichi && this.isIppatsuValid, isRinshan: this.rinshan, isChankan: isChankan,
            isHoutei: (!isTsumo && this.wall.length === 0), isHaitei: (isTsumo && this.wall.length === 0),
            isTenhou: (isTsumo && player.firstTurn && playerIndex === this.dealerIndex),
            isChiihou: (isTsumo && player.firstTurn && playerIndex !== this.dealerIndex && this.kanCount === 0),
            bakaze: this.roundWind, jikaze: CONSTANTS.WINDS[(playerIndex - this.dealerIndex + 4) % 4], 
            doraIndicators: this.doraIndicators, uraDoraIndicators: this.uraDoraIndicators, settings: this.settings
        };
        return this.yakuEvaluator.evaluate(player.hand, player.melds, stateObj);
    }

    getWinningTiles(playerId, testHand = null) {
        let p = this.players[playerId];
        let hand = testHand || p.hand;
        let playerIndex = this.playerIds.indexOf(playerId);
        
        let winning = [];
        for (let winTile of CONSTANTS.TILES) {
            let totalCount = hand.filter(t => t === winTile).length;
            p.melds.forEach(m => { if (m.tile === winTile) totalCount += (m.type === 'kantsu' ? 4 : 3); });
            if (totalCount >= 4) continue;
            let state = { winTileRaw: winTile, isTsumo: false, isRiichi: p.riichi, bakaze: this.roundWind, jikaze: CONSTANTS.WINDS[(playerIndex - this.dealerIndex + 4) % 4], doraIndicators: [], uraDoraIndicators: [] };
            if (this.yakuEvaluator.evaluate([...hand, winTile], p.melds, state)) {
                winning.push(winTile);
            }
        }
        return winning;
    }

    isTenpai(playerId) {
        let p = this.players[playerId];
        let hLen = p.hand.length;
        if (hLen % 3 === 1) return this.getWinningTiles(playerId, p.hand).length > 0;
        if (hLen % 3 === 2) {
            for (let i = 0; i < p.hand.length; i++) {
                let testHand = [...p.hand]; testHand.splice(i, 1);
                if (this.getWinningTiles(playerId, testHand).length > 0) return true;
            }
        }
        return false;
    }

    isFuriten(playerId) {
        let p = this.players[playerId];
        if (p.tempFuriten || p.riichiFuriten) return true;
        let winningTiles = this.getWinningTiles(playerId);
        for (let wt of winningTiles) {
            let normWt = this.yakuEvaluator.helper.safeNormalize(wt);
            if (p.discards.some(d => this.yakuEvaluator.helper.safeNormalize(d) === normWt)) return true;
        }
        return false;
    }

    canRon(playerId, tile, isChankan = false) { 
        if (this.isFuriten(playerId)) return false; 
        return this.checkWin(playerId, tile, false, isChankan) !== null; 
    }

    handlePlayerDiscard(playerId, tileIndex) {
        try {
            this.lastDiscardTile = this.handManager.discard(playerId, tileIndex);
        } catch (e) {
            Logger.error('Discard Error', e); return;
        }
        
        this.lastDiscardPlayer = playerId;
        this.actionResponses = {};
        this.waitingFor = [];
        this.actionResolved = false; 
        this.rinshan = false; 
        
        this.playerIds.forEach(id => {
            if (id !== playerId) {
                let canR = this.canRon(id, this.lastDiscardTile);
                let canP = !this.players[id].riichi && this.players[id].hand.filter(t => this.yakuEvaluator.helper.safeNormalize(t) === this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile)).length >= 2;
                if (canR || canP) this.waitingFor.push(id);
                else this.actionResponses[id] = 'PASS';
            }
        });

        if (this.waitingFor.length > 0) {
            this.phase = 'ACTION_WAIT';
            this.room.broadcastState();
            this.waitingFor.forEach(id => this.triggerAILogic(id));
        } else {
            this.proceedToNextTurn();
        }
    }

    proceedToNextTurn() {
        this.turnCount++;
        
        if (this.turnCount === 4) {
            let noMelds = this.playerIds.every(id => this.players[id].melds.length === 0);
            if (noMelds) {
                let firstDiscard = this.players[this.playerIds[0]].discards[0];
                if (['1z','2z','3z','4z'].includes(this.yakuEvaluator.helper.safeNormalize(firstDiscard))) {
                    let allSame = this.playerIds.every(id => this.yakuEvaluator.helper.safeNormalize(this.players[id].discards[0]) === this.yakuEvaluator.helper.safeNormalize(firstDiscard));
                    if (allSame) { this.handleRyuukyoku('四風連打'); return; }
                }
            }
        }
        
        if (this.playerIds.filter(id => this.players[id].riichi).length === 4) {
            this.handleRyuukyoku('四家立直'); return;
        }

        this.phase = 'DRAW';
        let nextId = this.turnManager.next();
        if (!this.handManager.draw(nextId)) {
            this.handleRyuukyoku();
            return;
        }
        this.isIppatsuValid = false; 
        this.room.broadcastState();
        this.triggerAILogic(nextId);
    }

    resolveActions() {
        if (this.actionResolved) return; 

        let allResponded = this.waitingFor.every(id => this.actionResponses[id]);
        if (!allResponded) return;

        this.actionResolved = true; 

        let ronPlayers = []; let ponPlayer = null;
        let discardIdx = this.playerIds.indexOf(this.lastDiscardPlayer);
        
        for (let i = 1; i < this.playerIds.length; i++) {
            let idx = (discardIdx + i) % this.playerIds.length;
            let id = this.playerIds[idx];
            if (this.actionResponses[id]?.type === 'RON') ronPlayers.push(id);
            else if (this.actionResponses[id]?.type === 'PON' && !ponPlayer) ponPlayer = id;
            else if (this.actionResponses[id] === 'PASS' || this.actionResponses[id]?.type === 'PASS') {
                if (this.canRon(id, this.lastDiscardTile, this.chankanTile !== null)) {
                    this.players[id].tempFuriten = true;
                    if (this.players[id].riichi) this.players[id].riichiFuriten = true;
                }
            }
        }

        if (ronPlayers.length > 0) {
            this.phase = 'FINISHED';
            this.winner = ronPlayers;
            this.winningType = ronPlayers.length === 1 ? 'RON' : 'RON_MULTI';
            this.winningYaku = ronPlayers.map(pId => this.checkWin(pId, this.lastDiscardTile, false, this.chankanTile !== null));
            
            let isDealerWin = false;
            ronPlayers.forEach((pId, idx) => {
                this.players[pId].hand.push(this.lastDiscardTile);
                let yakuData = this.winningYaku[idx];
                let pt = yakuData.point.total + (this.honba * CONSTANTS.COST.HONBA);
                yakuData.point.total = pt; 
                
                this.points[this.lastDiscardPlayer] -= pt;
                this.points[pId] += pt;
                
                if (idx === 0) { 
                    this.points[pId] += (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    this.kyoutaku = 0;
                }
                if (this.playerIds.indexOf(pId) === this.dealerIndex) isDealerWin = true;
            });

            this.playerIds.forEach(id => this.players[id].openHand = true);
            this.room.broadcastState();
            setTimeout(() => this.nextRound(isDealerWin, true), 7000);
        } else if (ponPlayer) {
            this.isIppatsuValid = false; 
            let activeId = ponPlayer;
            let player = this.players[activeId];
            let t = this.lastDiscardTile; 
            
            player.firstTurn = false;
            this.players[this.lastDiscardPlayer].discards.pop(); 
            
            let c = 0;
            for (let i = player.hand.length - 1; i >= 0; i--) {
                if (this.yakuEvaluator.helper.safeNormalize(player.hand[i]) === this.yakuEvaluator.helper.safeNormalize(t) && c < 2) { 
                    player.hand.splice(i, 1); c++; 
                }
            }
            player.melds.push({ type: 'koutsu', tile: t, isOpen: true });
            
            this.currentTurn = this.playerIds.indexOf(activeId);
            this.actionResponses = {}; this.waitingFor = [];
            
            this.phase = 'DRAW'; 
            this.room.broadcastState();
            this.triggerAILogic(activeId); 
        } else {
            this.proceedToNextTurn();
        }
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (!this.turnManager.isCurrentPlayer(playerId)) return;

            if (action.type === 'KYUUSHU') {
                this.handleRyuukyoku('九種九牌');
                return;
            }

            if (action.type === 'RIICHI') {
                if (this.points[playerId] < CONSTANTS.COST.RIICHI) return; 
                let discards = [];
                for (let i = 0; i < this.players[playerId].hand.length; i++) {
                    let testHand = [...this.players[playerId].hand]; testHand.splice(i, 1);
                    let winning = this.getWinningTiles(playerId, testHand);
                    if (winning.length > 0) discards.push({ index: i, tile: this.players[playerId].hand[i], winningTiles: winning });
                }

                if (discards.length > 0) {
                    const playerInfo = this.room.players.get(playerId);
                    if (playerInfo && playerInfo.isAI) {
                        this.handlePlayerAction(playerId, { type: 'DO_RIICHI', payload: { tileIndex: discards[0].index } });
                    } else if (playerInfo && playerInfo.ws) {
                        playerInfo.ws.send(JSON.stringify({ type: 'REACH_OPTIONS', payload: { discards } }));
                    }
                }
                return;
            }

            if (action.type === 'DO_RIICHI') {
                this.players[playerId].riichi = true;
                if (this.players[playerId].firstTurn) this.players[playerId].doubleRiichi = true;
                this.points[playerId] -= CONSTANTS.COST.RIICHI; 
                this.kyoutaku++;
                this.isIppatsuValid = true; 
                this.rinshan = false; 
                this.handlePlayerDiscard(playerId, action.payload.tileIndex);
                return;
            }

            if (action.type === 'DISCARD') {
                this.rinshan = false; 
                this.handlePlayerDiscard(playerId, action.payload.tileIndex);
            } else if (action.type === 'TSUMO') {
                let yakuResult = this.checkWin(playerId, null, true);
                if (yakuResult) {
                    this.rinshan = false; 
                    this.phase = 'FINISHED'; this.winner = [playerId]; this.winningType = 'TSUMO'; this.winningYaku = [yakuResult]; 
                    
                    let pInfo = yakuResult.point;
                    let isDealerWin = (playerId === this.playerIds[this.dealerIndex]);
                    
                    if (pInfo.dealerPay === 0) { 
                        let pay = pInfo.nonDealerPay + (this.honba * CONSTANTS.COST.TSUMO_HONBA);
                        this.playerIds.forEach(id => { if (id !== playerId) this.points[id] -= pay; });
                        let totalGet = pay * (this.playerIds.length - 1);
                        yakuResult.point.total = totalGet;
                        this.points[playerId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    } else { 
                        let dPay = pInfo.dealerPay + (this.honba * CONSTANTS.COST.TSUMO_HONBA);
                        let nPay = pInfo.nonDealerPay + (this.honba * CONSTANTS.COST.TSUMO_HONBA);
                        this.playerIds.forEach(id => {
                            if (id !== playerId) {
                                let isD = (this.playerIds.indexOf(id) === this.dealerIndex);
                                this.points[id] -= isD ? dPay : nPay;
                            }
                        });
                        let totalGet = dPay + nPay * (this.playerIds.length - 2);
                        yakuResult.point.total = totalGet;
                        this.points[playerId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    }
                    this.kyoutaku = 0;

                    this.playerIds.forEach(id => this.players[id].openHand = true);
                    this.room.broadcastState();
                    setTimeout(() => this.nextRound(isDealerWin, true), 7000); 
                }
            }
        } 
        else if (this.phase === 'ACTION_WAIT') {
            if (playerId === this.lastDiscardPlayer || !this.waitingFor.includes(playerId)) return;
            if (action.type === 'RON' && !this.isFuriten(playerId) && this.checkWin(playerId, this.lastDiscardTile, false, this.chankanTile !== null)) this.actionResponses[playerId] = { type: 'RON' };
            else if (action.type === 'PON' && !this.players[playerId].riichi && this.players[playerId].hand.filter(t => this.yakuEvaluator.helper.safeNormalize(t) === this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile)).length >= 2) this.actionResponses[playerId] = { type: 'PON' };
            else if (action.type === 'PASS') this.actionResponses[playerId] = { type: 'PASS' };
            this.resolveActions();
        }
    }

    triggerAILogic(playerId) {
        let player = this.players[playerId];
        const playerInfo = this.room.players.get(playerId);
        let isBot = playerInfo && playerInfo.isAI;

        if (this.phase === 'DRAW' && this.turnManager.isCurrentPlayer(playerId)) {
            setTimeout(() => {
                if (this.phase !== 'DRAW') return;
                let canWin = this.checkWin(playerId, null, true);
                if (canWin) {
                    this.handlePlayerAction(playerId, { type: 'TSUMO' });
                } else {
                    if (player.riichi) {
                        this.handlePlayerAction(playerId, { type: 'DISCARD', payload: { tileIndex: player.hand.length - 1 }});
                        return;
                    }
                    if (isBot) {
                        let level = this.settings.cpuLevel || 'normal';
                        let bestAction = this.ai.chooseDiscard(playerId, level);
                        this.handlePlayerAction(playerId, bestAction);
                    }
                }
            }, 1000);
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(playerId)) {
            if (isBot) {
                setTimeout(() => {
                    if (this.phase !== 'ACTION_WAIT') return;
                    if (!this.isFuriten(playerId) && this.checkWin(playerId, this.lastDiscardTile, false, this.chankanTile !== null)) this.handlePlayerAction(playerId, { type: 'RON' });
                    else this.handlePlayerAction(playerId, { type: 'PASS' });
                }, 800);
            }
        }
    }

    getClientState(targetPlayerId) {
        const maskedHands = {}; const mappedMelds = {}; const mappedDiscards = {}; const mappedRiichi = {};
        const mappedPlayers = this.playerIds.map(id => ({ id, points: this.points[id], isRiichi: this.players[id].riichi }));

        this.playerIds.forEach(id => {
            let p = this.players[id];
            if (id === targetPlayerId || this.phase === 'FINISHED' || this.room.settings.openHands || p.openHand) maskedHands[id] = p.hand;
            else maskedHands[id] = p.hand.map(() => 'back');
            mappedMelds[id] = p.melds; mappedDiscards[id] = p.discards; mappedRiichi[id] = p.riichi;
        });

        let allowedActions = [];
        if (this.phase === 'DRAW' && this.turnManager.isCurrentPlayer(targetPlayerId)) {
            let p = this.players[targetPlayerId];
            
            if (p.firstTurn && p.melds.length === 0 && p.hand.length % 3 === 2) {
                let yaochuCount = new Set(p.hand.map(t => this.yakuEvaluator.helper.safeNormalize(t)).filter(t => t && t.match(/[19z]/))).size;
                if (yaochuCount >= 9) allowedActions.push('KYUUSHU');
            }

            if (p.hand.length % 3 === 2 && !p.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
                if (this.points[targetPlayerId] >= 1000 && this.isTenpai(targetPlayerId)) allowedActions.push('RIICHI');
            } else if (p.hand.length % 3 === 2 && p.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
            }
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(targetPlayerId)) {
            if (!this.actionResponses[targetPlayerId]) {
                if (!this.isFuriten(targetPlayerId) && this.checkWin(targetPlayerId, this.lastDiscardTile, false, this.chankanTile !== null)) allowedActions.push('RON');
                if (!this.players[targetPlayerId].riichi && this.players[targetPlayerId].hand.filter(t => this.yakuEvaluator.helper.safeNormalize(t) === this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile)).length >= 2) allowedActions.push('PON');
                allowedActions.push('PASS'); 
            }
        }

        let roundName = CONSTANTS.WINDS[['1z','2z','3z','4z'].indexOf(this.roundWind)].replace('z', '') + this.kyoku + '局';

        return {
            phase: this.phase, turnPlayerId: this.turnManager.getCurrent(), wallCount: this.wall.length,
            hands: maskedHands, melds: mappedMelds, discards: mappedDiscards, allowedActions: allowedActions,
            lastDiscard: { playerId: this.lastDiscardPlayer, tile: this.lastDiscardTile },
            winner: this.winner, winningType: this.winningType, winningYaku: this.winningYaku, 
            riichiPlayers: mappedRiichi, doraIndicators: this.doraIndicators,
            players: mappedPlayers, kyoutaku: this.kyoutaku,
            roundInfo: `${roundName} ${this.honba}本場`
        };
    }
}

module.exports = MahjongGame;