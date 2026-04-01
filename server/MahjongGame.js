/**
 * Mahjong Server Engine (Professional Edition)
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
        this.suukansanraPending = false;

        this.finalResults = null;
        this.endReason = null;
        
        // 【追加】放置対策用のタイマー
        this.turnTimer = null;

        this._setupManagers();
        this.startRound();
    }

    // 【追加】思考時間の文字列（例: '5+10'）を秒数にパースする
    parseThinkTime(str) {
        if (!str) return 15;
        let parts = str.split('+');
        if (parts.length === 2) return parseInt(parts[0]) + parseInt(parts[1]);
        return parseInt(str) || 15;
    }

    // 【追加】放置対策（AFK）タイマーの起動
    resetTimer() {
        clearTimeout(this.turnTimer);
        if (this.phase === 'FINISHED' || this.phase === 'FINISHED_GAME') return;
        
        // 通信遅延やアニメーションを考慮して +2秒 の猶予を持たせる
        let timeMs = this.parseThinkTime(this.settings.thinkTime) * 1000 + 2000;
        
        this.turnTimer = setTimeout(() => {
            this.handleTimeout();
        }, timeMs);
    }

    // 【追加】時間切れ時の自動処理
    handleTimeout() {
        if (this.phase === 'DRAW') {
            let current = this.turnManager.getCurrent();
            let p = this.players[current];
            if (p) {
                // 自動ツモ切り
                let tileIndex = p.hand.length - 1;
                this.handlePlayerAction(current, { type: 'DISCARD', payload: { tileIndex } });
            }
        } else if (this.phase === 'ACTION_WAIT') {
            // 未応答のプレイヤー全員を自動で「パス」にする
            this.waitingFor.forEach(id => {
                if (!this.actionResponses[id]) {
                    this.handlePlayerAction(id, { type: 'PASS' });
                }
            });
        }
    }

    _setupManagers() {
        const self = this;

        this.turnManager = {
            getCurrent: () => self.playerIds[self.currentTurn],
            next: () => {
                self.currentTurn = (self.currentTurn + 1) % self.playerIds.length;
                return self.playerIds[self.currentTurn];
            },
            isCurrentPlayer: (id) => self.playerIds[self.currentTurn] === id
        };

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
                let isSanma = (self.settings.mode === 3);

                if (isTsumo) {
                    if (isSanma) {
                        let ronTotal = Math.ceil((basePoint * (isDealer ? 6 : 4)) / 100) * 100;
                        if (isDealer) {
                            let pay = Math.ceil((ronTotal / 2) / 100) * 100;
                            point.total = pay * 2;
                            point.nonDealerPay = pay;
                        } else {
                            let pay = Math.ceil((ronTotal / 2) / 100) * 100;
                            point.total = pay * 2;
                            point.dealerPay = pay;
                            point.nonDealerPay = pay;
                        }
                    } else {
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
                    }
                } else {
                    point.total = Math.ceil((basePoint * (isDealer ? 6 : 4)) / 100) * 100;
                }
                return point;
            }
        };

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
                },
                // 【追加】ローカル役：十三不塔（シーサンプーター）の判定
                isShiisanpuutaa: (handNorm) => {
                    let counts = {};
                    handNorm.forEach(t => counts[t] = (counts[t] || 0) + 1);
                    let pairs = 0;
                    for (let k in counts) {
                        if (counts[k] > 2) return false;
                        if (counts[k] === 2) pairs++;
                    }
                    if (pairs !== 1) return false;
                    let suits = { m: [], p: [], s: [] };
                    handNorm.forEach(t => { if (t[1] !== 'z') suits[t[1]].push(parseInt(t[0])); });
                    for (let suit in suits) {
                        let arr = suits[suit].sort((a,b) => a-b);
                        for (let i = 0; i < arr.length - 1; i++) {
                            if (arr[i+1] - arr[i] < 3) return false; 
                        }
                    }
                    return true;
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
                    // 【追加】ローカル役：十三不塔
                    if (stateObj.settings.localYaku && stateObj.isFirstTurn && stateObj.kanCount === 0) {
                        if (self.yakuEvaluator.special.isShiisanpuutaa(handNorm)) {
                            let point = self.scoreCalculator.calculate(13, 20, stateObj.isDealer, stateObj.isTsumo);
                            return { han: 13, yaku: ['十三不塔'], fu: 20, point: point };
                        }
                    }

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

                // 【追加】ローカル役：人和（レンホウ）
                if (result && result.han > 0) {
                    if (stateObj.settings.localYaku && !isTsumo && stateObj.isFirstTurn && stateObj.kanCount === 0 && !stateObj.isDealer) {
                        result.han = 13;
                        result.yaku = ['人和'];
                        result.point = self.scoreCalculator.calculate(13, 20, false, false);
                        return result;
                    }

                    let doraHan = self.yakuEvaluator.helper.countDora(allTilesRaw, doraIndicators, uraDoraIndicators, isRiichi || isDoubleRiichi) + (stateObj.kitaCount || 0);
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

        this.handManager = {
            draw: (playerId) => {
                if (self.wall.length === 0) return false;
                self.players[playerId].hand.push(self.wall.pop());
                self.players[playerId].tempFuriten = false;
                return true;
            },
            drawRinshan: (playerId) => {
                if (self.kanCount >= 4) return false; 
                self.kanPlayers.add(playerId);
                self.players[playerId].hand.push(self.deadWall.pop());
                self.doraIndicators.push(self.deadWall[self.kanCount * 2 + 2]);
                self.uraDoraIndicators.push(self.deadWall[self.kanCount * 2 + 3]);
                self.kanCount++;
                self.wall.pop(); 
                
                if (self.kanCount === 4 && self.kanPlayers.size > 1) {
                    self.suukansanraPending = true;
                }
                return true;
            },
            discard: (playerId, tileIndex) => {
                if (!playerId || typeof playerId !== 'string') throw new Error('Invalid playerId');
                if (tileIndex < 0 || tileIndex >= self.players[playerId].hand.length) throw new Error('Invalid index');
                const tile = self.players[playerId].hand.splice(tileIndex, 1)[0];
                if (!tile || typeof tile !== 'string') throw new Error('Invalid tile');
                
                self.players[playerId].discards.push(tile);
                self.players[playerId].furitenDiscards.push(tile); 
                self.players[playerId].firstTurn = false;
                return tile;
            }
        };

        this.ai = {
            chooseDiscard: (playerId, level) => {
                let p = self.players[playerId];
                if (level === 'easy') return { type: 'DISCARD', payload: { tileIndex: p.hand.length - 1 } };

                let stateTemplate = { isRiichi: true, bakaze: self.roundWind, jikaze: CONSTANTS.WINDS[(self.playerIds.indexOf(playerId) - self.dealerIndex + self.playerIds.length) % self.playerIds.length] };
                let reachable = [];
                for (let i = 0; i < p.hand.length; i++) {
                    let testHand = [...p.hand]; testHand.splice(i, 1);
                    let winning = self.getWinningTiles(playerId, testHand);
                    if (winning.length > 0) reachable.push({ index: i, tile: p.hand[i], winningTiles: winning });
                }

                if (reachable.length > 0) {
                    reachable.sort((a, b) => b.winningTiles.length - a.winningTiles.length);
                    for (let r of reachable) {
                        let norm = self.yakuEvaluator.helper.safeNormalize(r.tile);
                        if (!p.forbiddenDiscards.includes(norm)) {
                            if (r.winningTiles.length >= 4 || self.points[playerId] >= 1000) return { type: 'RIICHI' }; 
                            return { type: 'DISCARD', payload: { tileIndex: r.index } };
                        }
                    }
                }

                let hand = p.hand;
                let tileCounts = self.yakuEvaluator.helper.countTiles(hand);
                let bestIndex = -1;
                let maxScore = -9999;
                
                let safeTiles = new Set();
                let isSomeoneRiichi = false;
                self.playerIds.forEach(id => {
                    if (id !== playerId && self.players[id].riichi) {
                        isSomeoneRiichi = true;
                        self.players[id].discards.forEach(d => safeTiles.add(self.yakuEvaluator.helper.safeNormalize(d)));
                    }
                });

                // 【追加】AIの高度な手作り（Honitsu判定用）
                let suitCounts = { m: 0, p: 0, s: 0, z: 0 };
                if (level === 'hard') {
                    hand.forEach(t => { suitCounts[t[1]]++; });
                }
                let targetSuit = null;
                if (level === 'hard') {
                    let maxSuit = ['m','p','s'].reduce((a, b) => suitCounts[a] > suitCounts[b] ? a : b);
                    if (suitCounts[maxSuit] >= 6) targetSuit = maxSuit;
                }

                for (let i = 0; i < hand.length; i++) {
                    let tile = hand[i];
                    let norm = self.yakuEvaluator.helper.safeNormalize(tile);
                    
                    if (p.forbiddenDiscards.includes(norm)) continue;

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
                            
                            // 【追加】中張牌（3〜7）を大切にする（AI強化）
                            if (level === 'hard' && num >= 3 && num <= 7) score -= 8;
                        } else {
                            score += 15; 
                            // 【追加】役牌の対子・暗刻は大切にする
                            if (level === 'hard' && (CONSTANTS.SANGEN.includes(norm) || norm === self.roundWind || norm === CONSTANTS.WINDS[(self.playerIds.indexOf(playerId) - self.dealerIndex + self.playerIds.length) % self.playerIds.length])) {
                                if (tileCounts[norm] >= 2) score -= 30;
                            }
                        }
                    }

                    // 【追加】ホンイツ狙いの場合の重み付け
                    if (level === 'hard' && targetSuit) {
                        if (suit !== targetSuit && suit !== 'z') score += 40; // 違う色は真っ先に捨てる
                        if (suit === targetSuit) score -= 20; // ターゲット色は残す
                    }

                    let isDora = self.doraIndicators.map(ind => self.yakuEvaluator.helper.getDoraTile(ind)).includes(norm);
                    if (isDora) score -= 30; 
                    
                    if (isSomeoneRiichi) {
                        if (safeTiles.has(norm)) score += 100; 
                        else if (suit !== 'z') score -= 50; 
                    }

                    if (score > maxScore) { maxScore = score; bestIndex = i; }
                }
                
                if (bestIndex === -1) bestIndex = hand.length - 1;

                return { type: 'DISCARD', payload: { tileIndex: bestIndex } };
            }
        };
    }

    startRound() {
        log(`Round Start: ${this.roundWind} ${this.kyoku} Kyoku, Honba: ${this.honba}`);
        
        const tiles = [];
        for (let suit of ['m', 'p', 's']) {
            for (let i = 1; i <= 9; i++) { 
                if (this.settings.mode === 3 && suit === 'm' && i >= 2 && i <= 8) continue;
                for(let j=0; j<4; j++) tiles.push(i + suit); 
            }
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
                hand: [], discards: [], furitenDiscards: [], melds: [], 
                riichi: false, doubleRiichi: false, openHand: false,
                tempFuriten: false, riichiFuriten: false, firstTurn: true,
                kita: 0, forbiddenDiscards: [], pao: null 
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
        this.suukansanraPending = false;

        this.yakuEvaluator.helper.winningTilesCache.clear();

        this.playerIds.forEach(id => {
            for (let i = 0; i < 13; i++) { this.players[id].hand.push(this.wall.pop()); }
        });
        
        this.handManager.draw(this.turnManager.getCurrent());
        this.room.broadcastState();
        this.triggerAILogic(this.turnManager.getCurrent());
        
        this.resetTimer(); // タイマー開始
    }

    checkGameEnd() {
        let isEnd = false;
        let endReason = '';

        if (this.settings.tobi) {
            for (const id of this.playerIds) {
                if (this.points[id] < 0) {
                    isEnd = true;
                    endReason = 'トビ終了';
                    break;
                }
            }
        }

        if (!isEnd) {
            const isEastOnly = this.settings.length === 'east';
            const isSouthOnly = this.settings.length === 'south';
            const windIndex = CONSTANTS.WINDS.indexOf(this.roundWind); 

            if (isEastOnly && windIndex >= 1) { 
                isEnd = true; endReason = '東風戦終了';
            } else if (isSouthOnly && windIndex >= 2) { 
                isEnd = true; endReason = '半荘戦終了';
            }
        }

        if (isEnd) {
            clearTimeout(this.turnTimer);
            const sortedPlayers = [...this.playerIds].sort((a, b) => this.points[b] - this.points[a]);
            const finalResults = sortedPlayers.map((id, index) => ({
                id, rank: index + 1, points: this.points[id]
            }));
            this.room.handleGameEnd(finalResults, endReason);
            return true;
        }
        return false;
    }

    nextRound(isDealerWin, isDealerTenpai) {
        if (this.checkGameEnd()) return;

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

        if (this.checkGameEnd()) return;
        this.startRound();
    }

    handleRyuukyoku(reason = '荒牌平局') {
        clearTimeout(this.turnTimer);
        log(`Ryuukyoku: ${reason}`);
        
        if (reason === '荒牌平局') {
            let nagashiWinners = [];
            let nagashiYakuList = [];
            
            this.playerIds.forEach(id => {
                let p = this.players[id];
                if (p.discards.length > 0 && p.discards.length === p.furitenDiscards.length) {
                    let isAllYaochu = p.discards.every(d => CONSTANTS.YAOCHU.includes(this.yakuEvaluator.helper.safeNormalize(d)));
                    if (isAllYaochu) {
                        nagashiWinners.push(id);
                        let isDealer = (this.playerIds.indexOf(id) === this.dealerIndex);
                        let point = this.scoreCalculator.calculate(5, 20, isDealer, true); 
                        nagashiYakuList.push({ han: 5, fu: 20, yaku: ['流し満貫'], point: point });
                    }
                }
            });

            if (nagashiWinners.length > 0) {
                this.phase = 'FINISHED';
                this.winningType = 'TSUMO';
                this.winner = nagashiWinners;
                this.winningYaku = nagashiYakuList;
                
                let isDealerWin = false;
                nagashiWinners.forEach((pId, idx) => {
                    let yakuData = nagashiYakuList[idx];
                    let pInfo = yakuData.point;
                    let isD = (this.playerIds.indexOf(pId) === this.dealerIndex);
                    if (isD) isDealerWin = true;

                    if (pInfo.dealerPay === 0) {
                        let pay = pInfo.nonDealerPay;
                        this.playerIds.forEach(id => { if (id !== pId) this.points[id] -= pay; });
                        let totalGet = pay * (this.playerIds.length - 1);
                        yakuData.point.total = totalGet;
                        this.points[pId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    } else {
                        let dPay = pInfo.dealerPay;
                        let nPay = pInfo.nonDealerPay;
                        this.playerIds.forEach(id => {
                            if (id !== pId) {
                                let isD2 = (this.playerIds.indexOf(id) === this.dealerIndex);
                                this.points[id] -= isD2 ? dPay : nPay;
                            }
                        });
                        let totalGet = dPay + nPay * (this.playerIds.length - 2);
                        yakuData.point.total = totalGet;
                        this.points[pId] += totalGet + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    }
                    if (idx === 0) this.kyoutaku = 0;
                });
                
                this.playerIds.forEach(id => this.players[id].openHand = true);
                this.room.broadcastState();
                setTimeout(() => this.nextRound(isDealerWin, true), 7000);
                return;
            }
        }

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

    checkPao(playerId, tileNorm, discarderId) {
        let p = this.players[playerId];
        let sangenCount = p.melds.filter(m => m.isOpen && CONSTANTS.SANGEN.includes(this.yakuEvaluator.helper.safeNormalize(m.tile))).length;
        let windsCount = p.melds.filter(m => m.isOpen && CONSTANTS.WINDS.includes(this.yakuEvaluator.helper.safeNormalize(m.tile))).length;
        
        if (sangenCount === 3 && CONSTANTS.SANGEN.includes(tileNorm)) {
            p.pao = discarderId;
        } else if (windsCount === 4 && CONSTANTS.WINDS.includes(tileNorm)) {
            p.pao = discarderId;
        }
    }

    checkWin(playerId, winTile, isTsumo, isChankan = false) {
        let player = this.players[playerId];
        let actualWinTile = winTile || player.hand[player.hand.length - 1];
        let playerIndex = this.playerIds.indexOf(playerId);
        
        let jikazeIdx = (playerIndex - this.dealerIndex + this.playerIds.length) % this.playerIds.length;
        
        let stateObj = {
            winTileRaw: actualWinTile, isTsumo: isTsumo, isRiichi: player.riichi, isDoubleRiichi: player.doubleRiichi,
            isIppatsu: player.riichi && this.isIppatsuValid, isRinshan: this.rinshan, isChankan: isChankan,
            isHoutei: (!isTsumo && this.wall.length === 0), isHaitei: (isTsumo && this.wall.length === 0),
            isFirstTurn: player.firstTurn, kanCount: this.kanCount, isDealer: playerIndex === this.dealerIndex,
            isTenhou: (isTsumo && player.firstTurn && playerIndex === this.dealerIndex),
            isChiihou: (isTsumo && player.firstTurn && playerIndex !== this.dealerIndex && this.kanCount === 0),
            bakaze: this.roundWind, jikaze: CONSTANTS.WINDS[jikazeIdx], 
            doraIndicators: this.doraIndicators, uraDoraIndicators: this.uraDoraIndicators, settings: this.settings,
            kitaCount: player.kita
        };
        return this.yakuEvaluator.evaluate(player.hand, player.melds, stateObj);
    }

    getWinningTiles(playerId, testHand = null) {
        let p = this.players[playerId];
        let hand = testHand || p.hand;
        let playerIndex = this.playerIds.indexOf(playerId);
        let jikazeIdx = (playerIndex - this.dealerIndex + this.playerIds.length) % this.playerIds.length;
        
        let winning = [];
        for (let winTile of CONSTANTS.TILES) {
            let totalCount = hand.filter(t => t === winTile).length;
            p.melds.forEach(m => { if (m.tile === winTile) totalCount += (m.type === 'kantsu' ? 4 : 3); });
            if (totalCount >= 4) continue;
            let state = { 
                winTileRaw: winTile, isTsumo: false, isRiichi: p.riichi, bakaze: this.roundWind, jikaze: CONSTANTS.WINDS[jikazeIdx], 
                doraIndicators: [], uraDoraIndicators: [], kitaCount: p.kita, settings: this.settings, isFirstTurn: p.firstTurn, 
                kanCount: this.kanCount, isDealer: playerIndex === this.dealerIndex 
            };
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
            if (p.furitenDiscards.some(d => this.yakuEvaluator.helper.safeNormalize(d) === normWt)) return true;
        }
        return false;
    }

    canRon(playerId, tile, isChankan = false) { 
        if (this.isFuriten(playerId)) return false; 
        return this.checkWin(playerId, tile, false, isChankan) !== null; 
    }

    getChiOptions(playerId, tile) {
        if (this.settings.mode === 3) return []; 
        const p = this.players[playerId];
        if (p.riichi) return [];
        const norm = this.yakuEvaluator.helper.safeNormalize(tile);
        if (!norm || norm.includes('z')) return [];
        
        const suit = norm[1];
        const num = parseInt(norm[0]);
        const counts = this.yakuEvaluator.helper.countTiles(p.hand);
        let options = [];
        
        if (num >= 3 && counts[(num-2)+suit] > 0 && counts[(num-1)+suit] > 0) options.push([(num-2)+suit, (num-1)+suit]);
        if (num >= 2 && num <= 8 && counts[(num-1)+suit] > 0 && counts[(num+1)+suit] > 0) options.push([(num-1)+suit, (num+1)+suit]);
        if (num <= 7 && counts[(num+1)+suit] > 0 && counts[(num+2)+suit] > 0) options.push([(num+1)+suit, (num+2)+suit]);
        return options;
    }

    getKanOptions(playerId) {
        const p = this.players[playerId];
        if (p.riichi) return { ankan: [], kakan: [] }; 
        const counts = this.yakuEvaluator.helper.countTiles(p.hand);
        let ankan = []; let kakan = [];
        
        for (const [tile, count] of Object.entries(counts)) {
            if (count === 4) ankan.push(tile);
        }
        p.melds.forEach(m => {
            if (m.type === 'koutsu' && m.isOpen) {
                const normMeld = this.yakuEvaluator.helper.safeNormalize(m.tile);
                if (counts[normMeld] > 0) kakan.push(normMeld);
            }
        });
        return { ankan, kakan };
    }

    handlePlayerDiscard(playerId, tileIndex) {
        try {
            const tileCode = this.players[playerId].hand[tileIndex];
            if (!tileCode) return;
            const normCode = this.yakuEvaluator.helper.safeNormalize(tileCode);
            
            if (this.players[playerId].forbiddenDiscards && this.players[playerId].forbiddenDiscards.includes(normCode)) {
                return; 
            }
            this.players[playerId].forbiddenDiscards = [];

            this.lastDiscardTile = this.handManager.discard(playerId, tileIndex);
        } catch (e) {
            console.error('Discard Error', e); return;
        }
        
        this.lastDiscardPlayer = playerId;
        this.actionResponses = {};
        this.waitingFor = [];
        this.actionResolved = false; 
        this.rinshan = false; 
        
        const discardIdx = this.playerIds.indexOf(playerId);

        this.playerIds.forEach(id => {
            if (id !== playerId) {
                let canR = this.canRon(id, this.lastDiscardTile);
                let canP = !this.players[id].riichi && this.players[id].hand.filter(t => this.yakuEvaluator.helper.safeNormalize(t) === this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile)).length >= 3; 
                if (!canP) canP = !this.players[id].riichi && this.players[id].hand.filter(t => this.yakuEvaluator.helper.safeNormalize(t) === this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile)).length >= 2; 
                
                let canC = false;
                if (!this.players[id].riichi && this.playerIds.indexOf(id) === (discardIdx + 1) % this.playerIds.length) {
                    canC = this.getChiOptions(id, this.lastDiscardTile).length > 0;
                }

                if (canR || canP || canC) this.waitingFor.push(id);
                else this.actionResponses[id] = { type: 'PASS' }; 
            }
        });

        if (this.waitingFor.length > 0) {
            this.phase = 'ACTION_WAIT';
            this.room.broadcastState();
            this.triggerAILogic(null); // AIおよびタイマー発動用
            this.resetTimer();
        } else {
            if (this.suukansanraPending) {
                this.handleRyuukyoku('四槓散了');
                return;
            }
            this.proceedToNextTurn();
        }
    }

    proceedToNextTurn() {
        this.turnCount++;
        this.playerIds.forEach(id => this.players[id].tempFuriten = false);
        
        if (this.turnCount === 4 && this.settings.mode === 4) {
            let noMelds = this.playerIds.every(id => this.players[id].melds.length === 0);
            if (noMelds) {
                let firstDiscard = this.players[this.playerIds[0]].discards[0];
                if (firstDiscard && ['1z','2z','3z','4z'].includes(this.yakuEvaluator.helper.safeNormalize(firstDiscard))) {
                    let allSame = this.playerIds.every(id => {
                        let d = this.players[id].discards[0];
                        return d && this.yakuEvaluator.helper.safeNormalize(d) === this.yakuEvaluator.helper.safeNormalize(firstDiscard);
                    });
                    if (allSame) { this.handleRyuukyoku('四風連打'); return; }
                }
            }
        }
        
        if (this.playerIds.filter(id => this.players[id].riichi).length === this.settings.mode) {
            this.handleRyuukyoku(this.settings.mode === 3 ? '三家立直' : '四家立直'); return;
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
        this.resetTimer();
    }

    resolveActions() {
        if (this.actionResolved) return; 

        let allResponded = this.waitingFor.every(id => this.actionResponses[id]);
        if (!allResponded) return;

        this.actionResolved = true; 

        let ronPlayers = []; 
        let ponPlayer = null;
        let minkanPlayer = null;
        let chiPlayer = null;
        let chiTiles = null;

        let discardIdx = this.playerIds.indexOf(this.lastDiscardPlayer);
        
        for (let i = 1; i < this.playerIds.length; i++) {
            let idx = (discardIdx + i) % this.playerIds.length;
            let id = this.playerIds[idx];
            let res = this.actionResponses[id];
            
            if (res?.type === 'RON') ronPlayers.push(id);
            else if (res?.type === 'PON' && !ponPlayer && !minkanPlayer) ponPlayer = id;
            else if (res?.type === 'MINKAN' && !ponPlayer && !minkanPlayer) minkanPlayer = id;
            else if (res?.type === 'CHI' && !chiPlayer && i === 1) { 
                chiPlayer = id;
                chiTiles = res.payload.tiles;
            }
            else if (res === 'PASS' || res?.type === 'PASS') {
                if (this.canRon(id, this.lastDiscardTile, this.chankanTile !== null)) {
                    this.players[id].tempFuriten = true;
                    if (this.players[id].riichi) this.players[id].riichiFuriten = true;
                }
            }
        }

        if (ronPlayers.length > 0) {
            clearTimeout(this.turnTimer);
            this.phase = 'FINISHED';
            this.winner = ronPlayers;
            this.winningType = ronPlayers.length === 1 ? 'RON' : 'RON_MULTI';
            let actualWinTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;
            this.winningYaku = ronPlayers.map(pId => this.checkWin(pId, actualWinTile, false, this.chankanTile !== null));
            
            let isDealerWin = false;
            ronPlayers.forEach((pId, idx) => {
                this.players[pId].hand.push(actualWinTile);
                let yakuData = this.winningYaku[idx];
                let pt = yakuData.point.total + (this.honba * CONSTANTS.COST.HONBA);
                
                let paoPlayer = null;
                if (this.players[pId].pao && (yakuData.yaku.includes('大三元') || yakuData.yaku.includes('大四喜'))) {
                    paoPlayer = this.players[pId].pao;
                }

                if (paoPlayer && paoPlayer !== this.lastDiscardPlayer) {
                    let halfPt = Math.ceil(pt / 2);
                    this.points[this.lastDiscardPlayer] -= (pt - halfPt);
                    this.points[paoPlayer] -= halfPt;
                } else {
                    this.points[this.lastDiscardPlayer] -= pt;
                }
                
                this.points[pId] += pt;
                yakuData.point.total = pt; 
                
                if (idx === 0) { 
                    this.points[pId] += (this.kyoutaku * CONSTANTS.COST.RIICHI);
                    this.kyoutaku = 0;
                }
                if (this.playerIds.indexOf(pId) === this.dealerIndex) isDealerWin = true;
            });

            this.playerIds.forEach(id => this.players[id].openHand = true);
            this.room.broadcastState();
            setTimeout(() => this.nextRound(isDealerWin, true), 7000);

        } else if (this.chankanTile !== null) {
            let kakanPlayer = this.lastDiscardPlayer; 
            this.chankanTile = null;
            if (this.handManager.drawRinshan(kakanPlayer)) {
                this.phase = 'DRAW';
                this.rinshan = true;
                this.room.broadcastState();
                this.triggerAILogic(kakanPlayer);
                this.resetTimer();
            } else {
                this.handleRyuukyoku('四槓散了');
            }

        } else if (ponPlayer || minkanPlayer) {
            this.isIppatsuValid = false; 
            this.playerIds.forEach(id => this.players[id].tempFuriten = false);

            let activeId = ponPlayer || minkanPlayer;
            let player = this.players[activeId];
            let t = this.lastDiscardTile; 
            let normT = this.yakuEvaluator.helper.safeNormalize(t);
            
            player.firstTurn = false;
            this.players[this.lastDiscardPlayer].discards.pop(); 
            
            let c = 0;
            let removeCount = ponPlayer ? 2 : 3;
            for (let i = player.hand.length - 1; i >= 0; i--) {
                if (this.yakuEvaluator.helper.safeNormalize(player.hand[i]) === normT && c < removeCount) { 
                    player.hand.splice(i, 1); c++; 
                }
            }
            
            if (ponPlayer) {
                player.forbiddenDiscards = [normT];
                player.melds.push({ type: 'koutsu', tile: t, isOpen: true });
                this.checkPao(activeId, normT, this.lastDiscardPlayer); 
                
                this.currentTurn = this.playerIds.indexOf(activeId);
                this.actionResponses = {}; this.waitingFor = [];
                this.phase = 'DRAW'; 
                this.room.broadcastState();
                this.triggerAILogic(activeId); 
                this.resetTimer();
            } else if (minkanPlayer) {
                player.melds.push({ type: 'kantsu', tile: t, isOpen: true });
                this.checkPao(activeId, normT, this.lastDiscardPlayer); 
                
                this.currentTurn = this.playerIds.indexOf(activeId);
                this.actionResponses = {}; this.waitingFor = [];
                if (this.handManager.drawRinshan(activeId)) {
                    this.phase = 'DRAW';
                    this.rinshan = true;
                    this.room.broadcastState();
                    this.triggerAILogic(activeId);
                    this.resetTimer();
                } else {
                    this.handleRyuukyoku('四槓散了');
                }
            }

        } else if (chiPlayer) {
            this.isIppatsuValid = false; 
            this.playerIds.forEach(id => this.players[id].tempFuriten = false);

            let activeId = chiPlayer;
            let player = this.players[activeId];
            let t = this.lastDiscardTile; 
            let normT = this.yakuEvaluator.helper.safeNormalize(t);
            
            player.firstTurn = false;
            this.players[this.lastDiscardPlayer].discards.pop(); 

            for (let ct of chiTiles) {
                let idx = player.hand.findIndex(h => this.yakuEvaluator.helper.safeNormalize(h) === this.yakuEvaluator.helper.safeNormalize(ct));
                if (idx !== -1) player.hand.splice(idx, 1);
            }

            let numT = parseInt(normT[0]);
            let suitT = normT[1];
            let normChi = chiTiles.map(ct => this.yakuEvaluator.helper.safeNormalize(ct)).sort();
            let numC1 = parseInt(normChi[0][0]);
            let numC2 = parseInt(normChi[1][0]);

            let forbidden = [normT];
            if (numC1 === numT + 1 && numC2 === numT + 2 && numT + 3 <= 9) forbidden.push(`${numT + 3}${suitT}`);
            if (numC1 === numT - 2 && numC2 === numT - 1 && numT - 3 >= 1) forbidden.push(`${numT - 3}${suitT}`);
            player.forbiddenDiscards = forbidden;

            let meldTiles = [t, ...chiTiles].sort();
            player.melds.push({ type: 'shuntsu', tiles: meldTiles, isOpen: true });
            
            this.currentTurn = this.playerIds.indexOf(activeId);
            this.actionResponses = {}; this.waitingFor = [];
            this.phase = 'DRAW'; 
            this.room.broadcastState();
            this.triggerAILogic(activeId); 
            this.resetTimer();

        } else {
            if (this.suukansanraPending) {
                this.handleRyuukyoku('四槓散了');
                return;
            }
            this.proceedToNextTurn();
        }
    }

    handlePlayerAction(playerId, action) {
        if (this.phase === 'FINISHED') return;

        if (this.phase === 'DRAW') {
            if (!this.turnManager.isCurrentPlayer(playerId)) return;

            if (action.type === 'KITA' && this.settings.mode === 3) {
                const player = this.players[playerId];
                let idx = player.hand.findIndex(t => this.yakuEvaluator.helper.safeNormalize(t) === '4z');
                if (idx !== -1) {
                    player.hand.splice(idx, 1);
                    player.kita++;
                    if (this.handManager.draw(playerId)) {
                        this.rinshan = true;
                        this.room.broadcastState();
                        this.triggerAILogic(playerId);
                        this.resetTimer();
                    } else {
                        this.handleRyuukyoku('荒牌平局');
                    }
                }
                return;
            }

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

            if (action.type === 'ANKAN' || action.type === 'KAKAN') {
                const targetTile = action.payload.tile;
                const player = this.players[playerId];
                
                if (action.type === 'ANKAN') {
                    let c = 0;
                    for (let i = player.hand.length - 1; i >= 0; i--) {
                        if (this.yakuEvaluator.helper.safeNormalize(player.hand[i]) === this.yakuEvaluator.helper.safeNormalize(targetTile) && c < 4) { 
                            player.hand.splice(i, 1); c++; 
                        }
                    }
                    player.melds.push({ type: 'kantsu', tile: targetTile, isOpen: false });
                    
                    if (this.handManager.drawRinshan(playerId)) {
                        this.rinshan = true;
                        this.room.broadcastState();
                        this.triggerAILogic(playerId);
                        this.resetTimer();
                    } else {
                        this.handleRyuukyoku('四槓散了');
                    }
                } else if (action.type === 'KAKAN') {
                    const meldIdx = player.melds.findIndex(m => m.type === 'koutsu' && m.isOpen && this.yakuEvaluator.helper.safeNormalize(m.tile) === this.yakuEvaluator.helper.safeNormalize(targetTile));
                    if (meldIdx !== -1) {
                        player.melds[meldIdx].type = 'kantsu'; 
                        let handIdx = player.hand.findIndex(h => this.yakuEvaluator.helper.safeNormalize(h) === this.yakuEvaluator.helper.safeNormalize(targetTile));
                        if(handIdx !== -1) player.hand.splice(handIdx, 1);

                        this.chankanTile = targetTile;
                        this.lastDiscardPlayer = playerId; 
                        this.actionResponses = {};
                        this.waitingFor = [];
                        this.actionResolved = false;

                        this.playerIds.forEach(id => {
                            if (id !== playerId) {
                                if (this.canRon(id, targetTile, true)) this.waitingFor.push(id);
                            }
                        });

                        if (this.waitingFor.length > 0) {
                            this.phase = 'ACTION_WAIT';
                            this.room.broadcastState();
                            this.triggerAILogic(null);
                            this.resetTimer();
                        } else {
                            this.chankanTile = null;
                            if (this.handManager.drawRinshan(playerId)) {
                                this.rinshan = true;
                                this.room.broadcastState();
                                this.triggerAILogic(playerId);
                                this.resetTimer();
                            } else {
                                this.handleRyuukyoku('四槓散了');
                            }
                        }
                    }
                }
                return;
            }

            if (action.type === 'DISCARD') {
                this.rinshan = false; 
                this.handlePlayerDiscard(playerId, action.payload.tileIndex);
            } else if (action.type === 'TSUMO') {
                let yakuResult = this.checkWin(playerId, null, true);
                if (yakuResult) {
                    clearTimeout(this.turnTimer);
                    this.rinshan = false; 
                    this.phase = 'FINISHED'; this.winner = [playerId]; this.winningType = 'TSUMO'; this.winningYaku = [yakuResult]; 
                    
                    let pInfo = yakuResult.point;
                    let isDealerWin = (playerId === this.playerIds[this.dealerIndex]);
                    
                    let paoPlayer = null;
                    if (this.players[playerId].pao && (yakuResult.yaku.includes('大三元') || yakuResult.yaku.includes('大四喜'))) {
                        paoPlayer = this.players[playerId].pao;
                    }

                    if (paoPlayer) {
                        let totalPay = pInfo.total + (this.honba * CONSTANTS.COST.TSUMO_HONBA * (this.playerIds.length - 1));
                        this.points[paoPlayer] -= totalPay;
                        this.points[playerId] += totalPay + (this.kyoutaku * CONSTANTS.COST.RIICHI);
                        yakuResult.point.total = totalPay;
                    } else {
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
            
            let actualTargetTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;

            if (action.type === 'RON' && !this.isFuriten(playerId) && this.checkWin(playerId, actualTargetTile, false, this.chankanTile !== null)) {
                this.actionResponses[playerId] = { type: 'RON' };
            } 
            else if (this.chankanTile === null) {
                if (action.type === 'MINKAN' && !this.players[playerId].riichi && this.players[playerId].hand.filter(t => this.yakuEvaluator.helper.safeNormalize(t) === this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile)).length >= 3) {
                    this.actionResponses[playerId] = { type: 'MINKAN' };
                } else if (action.type === 'PON' && !this.players[playerId].riichi && this.players[playerId].hand.filter(t => this.yakuEvaluator.helper.safeNormalize(t) === this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile)).length >= 2) {
                    this.actionResponses[playerId] = { type: 'PON' };
                } else if (action.type === 'CHI' && !this.players[playerId].riichi && action.payload && action.payload.tiles) {
                    this.actionResponses[playerId] = { type: 'CHI', payload: { tiles: action.payload.tiles } };
                } else {
                    this.actionResponses[playerId] = { type: 'PASS' }; 
                }
            } else {
                this.actionResponses[playerId] = { type: 'PASS' }; 
            }
            this.resolveActions();
        }
    }

    triggerAILogic(playerId) {
        // playerIdがnullの場合は全員の待機チェックのみ
        if (playerId) {
            let player = this.players[playerId];
            const playerInfo = this.room.players.get(playerId);
            let isBot = playerInfo && playerInfo.isAI;

            if (this.phase === 'DRAW' && this.turnManager.isCurrentPlayer(playerId)) {
                setTimeout(() => {
                    if (this.phase !== 'DRAW') return;
                    
                    if (isBot && this.settings.mode === 3 && player.hand.some(t => t.endsWith('4z'))) {
                        this.handlePlayerAction(playerId, { type: 'KITA' });
                        return;
                    }

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
            }
        }
        
        if (this.phase === 'ACTION_WAIT') {
            this.waitingFor.forEach(id => {
                const playerInfo = this.room.players.get(id);
                if (playerInfo && playerInfo.isAI) {
                    setTimeout(() => {
                        if (this.phase !== 'ACTION_WAIT') return;
                        let p = this.players[id];
                        let level = this.settings.cpuLevel || 'normal';
                        let actualTargetTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;
                        
                        if (!this.isFuriten(id) && this.checkWin(id, actualTargetTile, false, this.chankanTile !== null)) {
                            this.handlePlayerAction(id, { type: 'RON' });
                        } 
                        else if (this.chankanTile === null && !p.riichi) {
                            let discNorm = this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile);
                            let counts = this.yakuEvaluator.helper.countTiles(p.hand);
                            let jikazeIdx = (this.playerIds.indexOf(id) - this.dealerIndex + this.playerIds.length) % this.playerIds.length;
                            let isYakuhai = CONSTANTS.SANGEN.includes(discNorm) || discNorm === this.roundWind || discNorm === CONSTANTS.WINDS[jikazeIdx];
                            
                            // 【AI強化】役牌やタンヤオを鳴くロジック
                            if (isYakuhai && counts[discNorm] >= 2) {
                                this.handlePlayerAction(id, { type: 'PON' });
                            } else if (level === 'hard') {
                                let isTanyaoTile = !!discNorm.match(/^[2-8][mps]$/);
                                if (isTanyaoTile && counts[discNorm] >= 2) {
                                    this.handlePlayerAction(id, { type: 'PON' });
                                } else {
                                    let chiOpts = this.getChiOptions(id, this.lastDiscardTile);
                                    let tanyaoChi = chiOpts.find(opt => opt.every(t => !!this.yakuEvaluator.helper.safeNormalize(t).match(/^[2-8][mps]$/)));
                                    if (isTanyaoTile && tanyaoChi && this.actionResponses[id] === undefined) {
                                        this.handlePlayerAction(id, { type: 'CHI', payload: { tiles: tanyaoChi }});
                                    } else {
                                        this.handlePlayerAction(id, { type: 'PASS' });
                                    }
                                }
                            } else {
                                this.handlePlayerAction(id, { type: 'PASS' });
                            }
                        } else {
                            this.handlePlayerAction(id, { type: 'PASS' });
                        }
                    }, 800);
                }
            });
        }
    }

    getClientState(targetPlayerId) {
        const maskedHands = {}; const mappedMelds = {}; const mappedDiscards = {}; const mappedRiichi = {}; const mappedKita = {};
        const mappedPlayers = this.playerIds.map(id => ({ id, points: this.points[id], isRiichi: this.players[id].riichi }));

        this.playerIds.forEach(id => {
            let p = this.players[id];
            if (id === targetPlayerId || this.phase === 'FINISHED' || this.room.settings.openHands || p.openHand) maskedHands[id] = p.hand;
            else maskedHands[id] = p.hand.map(() => 'back');
            mappedMelds[id] = p.melds; mappedDiscards[id] = p.discards; mappedRiichi[id] = p.riichi; mappedKita[id] = p.kita;
        });

        let allowedActions = [];
        let chiOptions = [];
        let kanOptions = { ankan: [], kakan: [] };
        let forbiddenDiscards = [];

        if (this.phase === 'DRAW' && this.turnManager.isCurrentPlayer(targetPlayerId)) {
            let p = this.players[targetPlayerId];
            forbiddenDiscards = p.forbiddenDiscards || [];
            
            if (p.firstTurn && p.melds.length === 0 && p.hand.length % 3 === 2) {
                let yaochuCount = new Set(p.hand.map(t => this.yakuEvaluator.helper.safeNormalize(t)).filter(t => t && t.match(/[19z]/))).size;
                if (yaochuCount >= 9) allowedActions.push('KYUUSHU');
            }

            if (p.hand.length % 3 === 2 && !p.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
                if (this.points[targetPlayerId] >= 1000 && this.isTenpai(targetPlayerId)) allowedActions.push('RIICHI');
                
                kanOptions = this.getKanOptions(targetPlayerId);
                if (kanOptions.ankan.length > 0) allowedActions.push('ANKAN');
                if (kanOptions.kakan.length > 0) allowedActions.push('KAKAN');
                
                if (this.settings.mode === 3 && p.hand.some(t => this.yakuEvaluator.helper.safeNormalize(t) === '4z')) {
                    allowedActions.push('KITA');
                }
            } else if (p.hand.length % 3 === 2 && p.riichi) {
                if (this.checkWin(targetPlayerId, null, true)) allowedActions.push('TSUMO');
            }
        } else if (this.phase === 'ACTION_WAIT' && this.waitingFor.includes(targetPlayerId)) {
            if (!this.actionResponses[targetPlayerId]) {
                let actualTargetTile = this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile;
                if (!this.isFuriten(targetPlayerId) && this.checkWin(targetPlayerId, actualTargetTile, false, this.chankanTile !== null)) {
                    allowedActions.push('RON');
                }
                
                if (this.chankanTile === null && !this.players[targetPlayerId].riichi) {
                    let handNorm = this.players[targetPlayerId].hand.map(t => this.yakuEvaluator.helper.safeNormalize(t));
                    let discNorm = this.yakuEvaluator.helper.safeNormalize(this.lastDiscardTile);
                    let count = handNorm.filter(t => t === discNorm).length;
                    
                    if (count >= 3) allowedActions.push('MINKAN');
                    if (count >= 2) allowedActions.push('PON');
                    
                    chiOptions = this.getChiOptions(targetPlayerId, this.lastDiscardTile);
                    if (chiOptions.length > 0) allowedActions.push('CHI');
                }
                allowedActions.push('PASS'); 
            }
        }

        let roundName = CONSTANTS.WINDS[['1z','2z','3z','4z'].indexOf(this.roundWind)].replace('z', '') + this.kyoku + '局';

        return {
            phase: this.phase, turnPlayerId: this.turnManager.getCurrent(), wallCount: this.wall.length,
            hands: maskedHands, melds: mappedMelds, discards: mappedDiscards, allowedActions: allowedActions,
            chiOptions: chiOptions, kanOptions: kanOptions, forbiddenDiscards: forbiddenDiscards,
            lastDiscard: { playerId: this.lastDiscardPlayer, tile: this.chankanTile !== null ? this.chankanTile : this.lastDiscardTile },
            winner: this.winner, winningType: this.winningType, winningYaku: this.winningYaku, 
            riichiPlayers: mappedRiichi, kitaPlayers: mappedKita, doraIndicators: this.doraIndicators,
            players: mappedPlayers, kyoutaku: this.kyoutaku,
            roundInfo: `${roundName} ${this.honba}本場`,
            finalResults: this.finalResults, endReason: this.endReason
        };
    }
}

module.exports = MahjongGame;