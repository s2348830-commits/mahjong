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

const YakuHelper = {
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
            let n = YakuHelper.safeNormalize(t);
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
        const norm = YakuHelper.safeNormalize(indicator);
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
        
        let doras = activeIndicators.map(ind => YakuHelper.getDoraTile(ind)).filter(d=>d);
        allTilesRaw.forEach(t => {
            if (t && t[0] === '0') count++; 
            let norm = YakuHelper.safeNormalize(t);
            if(norm) doras.forEach(d => { if (norm === d) count++; });
        });
        return count;
    }
};

const ScoreCalculator = {
    calculateFu: (melds, pair, winTile, isTsumo, isMenzen, bakaze, jikaze, isPinfu, isChiitoitsu) => {
        if (isChiitoitsu) return 25;
        if (isPinfu) return isTsumo ? 20 : 30;
        
        let fu = 20; 
        if (isMenzen && !isTsumo) fu += 10; 
        else if (isTsumo) fu += 2; 

        let normWin = YakuHelper.safeNormalize(winTile);
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
    calculate: (han, fu, isDealer, isTsumo, isSanma = false) => {
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

const YakuEvaluator = {
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

            let normWin = YakuHelper.safeNormalize(winTile);
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
            let normDeclaredMelds = declaredMelds.map(m => ({ ...m, tile: YakuHelper.safeNormalize(m.tile), tiles: m.tiles?.map(t => YakuHelper.safeNormalize(t)) }));
            
            let patterns = YakuHelper.getAllMeldPatterns(counts, normDeclaredMelds);
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

                let isPin = YakuEvaluator.standard.isPinfu(melds, pair, bakaze, jikaze, isMenzen, winTile);
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
                    let fu = ScoreCalculator.calculateFu(melds, pair, winTile, isTsumo, isMenzen, bakaze, jikaze, isPin, false);
                    let tempPoint = ScoreCalculator.calculate(han, fu, bakaze === jikaze, isTsumo, stateObj.settings.mode === 3);
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

        let handNorm = handRaw.map(t => YakuHelper.safeNormalize(t));
        let winTile = YakuHelper.safeNormalize(winTileRaw);
        if (!isTsumo && winTile) handNorm.push(winTile);

        let counts = YakuHelper.countTiles(handRaw);
        if (!isTsumo && winTile) counts[winTile] = (counts[winTile] || 0) + 1;

        let startYakuman = [];
        if (isTenhou) startYakuman.push('天和');
        if (isChiihou) startYakuman.push('地和');

        let result = null;

        if (isMenzen && handNorm.length === 14) {
            if (stateObj.settings.localYaku && stateObj.isFirstTurn && stateObj.kanCount === 0) {
                if (YakuEvaluator.special.isShiisanpuutaa(handNorm)) {
                    let point = ScoreCalculator.calculate(13, 20, stateObj.isDealer, stateObj.isTsumo, stateObj.settings.mode === 3);
                    return { han: 13, yaku: ['十三不塔'], fu: 20, point: point };
                }
            }

            if (YakuEvaluator.special.isKokushi(counts)) {
                let han = 13 + (startYakuman.length * 13); 
                let yaku = counts[winTile] === 2 ? ['国士無双十三面待ち'] : ['国士無双'];
                if (isTsumo && startYakuman.length === 0) yaku.push('門前清自摸和');
                yaku.push(...startYakuman);
                result = { han, yaku, fu: 20 };
            } else if (YakuEvaluator.special.isChiitoitsu(counts)) {
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

        let standardResult = YakuEvaluator.standard.evaluateStandard(handRaw, declaredMelds, stateObj, counts, allTilesRaw, handNorm, winTile, isMenzen);
        if (standardResult && (!result || standardResult.han > result.han)) {
            result = standardResult;
        }

        if (result && result.han > 0) {
            if (stateObj.settings.localYaku && !isTsumo && stateObj.isFirstTurn && stateObj.kanCount === 0 && !stateObj.isDealer) {
                result.han = 13;
                result.yaku = ['人和'];
                result.point = ScoreCalculator.calculate(13, 20, false, false, stateObj.settings.mode === 3);
                return result;
            }

            let doraHan = YakuHelper.countDora(allTilesRaw, doraIndicators, uraDoraIndicators, isRiichi || isDoubleRiichi) + (stateObj.kitaCount || 0);
            if (doraHan > 0 && result.han < 13) {
                result.han += doraHan;
                result.yaku.push(`ドラ${doraHan}`);
            }
            result.point = ScoreCalculator.calculate(result.han, result.fu, bakaze === jikaze, isTsumo, stateObj.settings.mode === 3);
            return result;
        }
        return null;
    }
};

module.exports = { CONSTANTS, YakuHelper, ScoreCalculator, YakuEvaluator };