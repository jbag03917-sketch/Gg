import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json());

// 국립국어원 표준국어대사전 Open API 기본 인증키 (서버 환경변수 우선 적용)
const DEFAULT_STDICT_API_KEY = process.env.STDICT_API_KEY || '4AF7F0CC6C8C1EA6D482DA8D117613F4';

// In-memory active public rooms registry
interface ActiveRoomRecord {
  id: string;
  title: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: string;
  isPublic: boolean;
  lastUpdated: number;
}

const activeRoomsMap = new Map<string, ActiveRoomRecord>();

// Clean up stale rooms (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of activeRoomsMap.entries()) {
    if (now - room.lastUpdated > 10 * 60 * 1000) {
      activeRoomsMap.delete(id);
    }
  }
}, 60000);

// API: List real active public rooms
app.get('/api/rooms', (req, res) => {
  const rooms = Array.from(activeRoomsMap.values()).filter(
    (r) => r.isPublic && r.status !== 'FINISHED'
  );
  res.json({ rooms });
});

// API: Register or update active room
app.post('/api/rooms/update', (req, res) => {
  const { id, title, hostName, playerCount, maxPlayers, status, isPublic } = req.body;
  if (!id || !title) {
    return res.status(400).json({ error: 'Missing room parameters' });
  }

  activeRoomsMap.set(id, {
    id,
    title,
    hostName: hostName || '방장',
    playerCount: playerCount || 1,
    maxPlayers: maxPlayers || 8,
    status: status || 'WAITING',
    isPublic: isPublic !== false,
    lastUpdated: Date.now(),
  });

  res.json({ success: true });
});

// API: Remove active room
app.post('/api/rooms/remove', (req, res) => {
  const { id } = req.body;
  if (id) {
    activeRoomsMap.delete(id);
  }
  res.json({ success: true });
});

// API: 국립국어원 표준국어대사전 Open API 실시간 단어 검색 & 검증 (동음이의어 및 다중 뜻풀이 전체 반환)
app.get('/api/dict/search', async (req, res) => {
  const word = String(req.query.q || '').trim();
  const apiKey = DEFAULT_STDICT_API_KEY;

  if (!word) {
    return res.status(400).json({ error: '검색할 단어를 입력해주세요.' });
  }

  try {
    // 1. 국립국어원 표준국어대사전 Open API - 상세 검색 (동음이의어 모두 포함하여 최대 30개 조회)
    let apiItems: any[] = [];
    
    // exact 일치 검색 시도 (배¹, 배², 배³ 등 모든 동음이의어 항목 포함)
    try {
      const stdictExactUrl = `https://stdict.korean.go.kr/api/search.do?key=${encodeURIComponent(
        apiKey
      )}&q=${encodeURIComponent(
        word
      )}&req_type=json&advanced=y&method=exact&type1=word&num=30`;

      const response = await fetch(stdictExactUrl, {
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const text = await response.text();
        try {
          const data = JSON.parse(text);
          if (data?.channel?.item && Array.isArray(data.channel.item)) {
            apiItems = data.channel.item;
          } else if (data?.channel?.item && typeof data.channel.item === 'object') {
            apiItems = [data.channel.item];
          }
        } catch {
          console.warn('STDict exact search parse fallback');
        }
      }
    } catch (e) {
      console.error('STDict exact fetch error:', e);
    }

    // 만약 일치 검색 결과가 적거나 없으면 시작/일반 검색으로 추가 확보
    if (apiItems.length === 0) {
      try {
        const fallbackUrl = `https://stdict.korean.go.kr/api/search.do?key=${encodeURIComponent(
          apiKey
        )}&q=${encodeURIComponent(word)}&req_type=json&advanced=y&method=start&type1=word&num=30`;

        const fbRes = await fetch(fallbackUrl, {
          headers: { Accept: 'application/json' },
        });

        if (fbRes.ok) {
          const fbText = await fbRes.text();
          try {
            const fbData = JSON.parse(fbText);
            if (fbData?.channel?.item && Array.isArray(fbData.channel.item)) {
              apiItems = fbData.channel.item;
            } else if (fbData?.channel?.item && typeof fbData.channel.item === 'object') {
              apiItems = [fbData.channel.item];
            }
          } catch {
            // ignore
          }
        }
      } catch (fbErr) {
        console.error('STDict start lookup error:', fbErr);
      }
    }

    // 2. 국립국어원 결과 매핑 (각 동음이의어 별도 아이템으로 보존 + 각 아이템별 다중 뜻풀이 보존)
    if (apiItems.length > 0) {
      const formattedItems = apiItems.map((it: any, index: number) => {
        const cleanWord = String(it.word || '').replace(/[0-9-^]/g, '').trim();
        const supNo = it.sup_no ? String(it.sup_no) : '';
        const itPos = it.pos || '명사';
        let itOrigin = it.origin || '';

        const itemSenses: Array<{
          senseNo?: number | string;
          definition: string;
          pos?: string;
          origin?: string;
          type?: string;
          link?: string;
        }> = [];

        if (Array.isArray(it.sense)) {
          it.sense.forEach((s: any, sIdx: number) => {
            const def = String(s.definition || '').trim();
            if (def) {
              if (!itOrigin && s.origin) itOrigin = s.origin;
              itemSenses.push({
                senseNo: s.sense_no || sIdx + 1,
                definition: def,
                pos: itPos,
                origin: s.origin || itOrigin || '표준어',
                type: s.type || '일반어',
                link: s.link || `https://stdict.korean.go.kr`,
              });
            }
          });
        } else if (it.sense && typeof it.sense === 'object') {
          const def = String(it.sense.definition || '').trim();
          if (def) {
            if (!itOrigin && it.sense.origin) itOrigin = it.sense.origin;
            itemSenses.push({
              senseNo: it.sense.sense_no || 1,
              definition: def,
              pos: itPos,
              origin: it.sense.origin || itOrigin || '표준어',
              type: it.sense.type || '일반어',
              link: it.sense.link || `https://stdict.korean.go.kr`,
            });
          }
        }

        const definitions = itemSenses.map((s, sIdx) => `${sIdx + 1}. ${s.definition}`);
        const primaryMeaning = itemSenses[0]?.definition || '국립국어원 표준국어대사전에 등재된 단어입니다.';

        return {
          id: `${cleanWord}-${supNo || index}-${it.target_code || index}`,
          word: cleanWord || word,
          supNo: supNo,
          pos: itPos,
          meaning: primaryMeaning,
          definitions: definitions.length > 0 ? definitions : [primaryMeaning],
          senses: itemSenses,
          length: (cleanWord || word).length,
          firstChar: (cleanWord || word)[0],
          lastChar: (cleanWord || word)[(cleanWord || word).length - 1],
          origin: itOrigin || '표준어',
          targetCode: it.target_code,
          source: 'STDICT' as const,
        };
      });

      // Filter or sort so exact word matches come first, followed by others
      formattedItems.sort((a, b) => {
        if (a.word === word && b.word !== word) return -1;
        if (b.word === word && a.word !== word) return 1;
        return 0;
      });

      return res.json({
        found: true,
        items: formattedItems,
        total: formattedItems.length,
        source: 'STDICT',
        attribution: '국립국어원 표준국어대사전 (CCL 2.0 KR)',
      });
    }

    // 3. 위키낱말사전 fallback
    try {
      const wiktionaryUrl = `https://ko.wiktionary.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(
        word
      )}&format=json&origin=*`;

      const wikiRes = await fetch(wiktionaryUrl, {
        headers: { 'User-Agent': 'KkeutitgiBot/1.0 (Korean Word Chain Game)' },
      });

      if (wikiRes.ok) {
        const wikiData = (await wikiRes.json()) as any;
        const pages = wikiData?.query?.pages || {};
        const pageId = Object.keys(pages)[0];

        if (pageId && pageId !== '-1') {
          const extract = pages[pageId]?.extract || '';
          let cleanMeaning = extract
            .replace(/==.*?==/g, '')
            .replace(/\[\[.*?\]\]/g, '')
            .trim();

          const rawLines = cleanMeaning
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 3 && !l.startsWith('='));

          const definitions = rawLines.length > 0 ? rawLines.slice(0, 5) : [cleanMeaning];
          const senses = definitions.map((d, i) => ({
            senseNo: i + 1,
            definition: d.replace(/^[0-9]+[.)]\s*/, ''),
            pos: '명사',
            origin: '표준어',
          }));

          return res.json({
            found: true,
            items: [
              {
                id: `${word}-wiki`,
                word,
                pos: extract.includes('명사') ? '명사' : '표준어',
                meaning: senses[0]?.definition || cleanMeaning,
                definitions,
                senses,
                length: word.length,
                firstChar: word[0],
                lastChar: word[word.length - 1],
                origin: '표준어',
                source: 'WIKTIONARY',
              },
            ],
            source: 'WIKTIONARY',
            attribution: '한국어 사전 정보',
          });
        }
      }
    } catch (wikiErr) {
      console.error('Wiktionary fallback error:', wikiErr);
    }

    return res.json({
      found: false,
      items: [],
      message: '국립국어원 표준국어대사전에 등재되지 않은 단어입니다.',
    });
  } catch (err: any) {
    console.error('Dictionary search exception:', err);
    res.status(500).json({ error: '사전 검색 중 오류가 발생했습니다.', details: err.message });
  }
});

// API: 국립국어원 표준국어대사전 실시간 단어 탐색 (무한 스크롤 및 전체 탐색용)
app.get('/api/dict/explore', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const num = Math.min(30, Math.max(10, parseInt(String(req.query.num || '20'), 10)));
  const apiKey = DEFAULT_STDICT_API_KEY;

  // Search keyword or cyclical seed prefixes across Korean syllables
  const SEED_PREFIXES = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하', '거', '너', '더', '러', '머', '버', '서', '어', '저', '처', '고', '노', '도', '로', '모', '보', '소', '오', '조', '초'];
  const searchChar = query || SEED_PREFIXES[(page - 1) % SEED_PREFIXES.length];

  try {
    const stdictUrl = `https://stdict.korean.go.kr/api/search.do?key=${encodeURIComponent(
      apiKey
    )}&q=${encodeURIComponent(
      searchChar
    )}&req_type=json&advanced=y&method=start&type1=word&start=${page}&num=${num}`;

    const response = await fetch(stdictUrl, {
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const text = await response.text();
      let apiItems: any[] = [];
      try {
        const data = JSON.parse(text);
        if (data?.channel?.item && Array.isArray(data.channel.item)) {
          apiItems = data.channel.item;
        } else if (data?.channel?.item && typeof data.channel.item === 'object') {
          apiItems = [data.channel.item];
        }
      } catch {
        // fallback
      }

      if (apiItems.length > 0) {
        const formattedWords = apiItems
          .map((it: any, idx: number) => {
            const cleanWord = String(it.word || '').replace(/[0-9-^]/g, '').trim();
            if (!cleanWord || /[^가-힣]/.test(cleanWord)) return null;

            const supNo = it.sup_no ? String(it.sup_no) : '';
            const itPos = it.pos || '명사';
            let itOrigin = it.origin || '';

            const itemSenses: Array<{
              senseNo?: number | string;
              definition: string;
              pos?: string;
              origin?: string;
              type?: string;
              link?: string;
            }> = [];

            if (Array.isArray(it.sense)) {
              it.sense.forEach((s: any, sIdx: number) => {
                const def = String(s.definition || '').trim();
                if (def) {
                  if (!itOrigin && s.origin) itOrigin = s.origin;
                  itemSenses.push({
                    senseNo: s.sense_no || sIdx + 1,
                    definition: def,
                    pos: itPos,
                    origin: s.origin || itOrigin || '표준어',
                    type: s.type || '일반어',
                    link: s.link || `https://stdict.korean.go.kr`,
                  });
                }
              });
            } else if (it.sense && typeof it.sense === 'object') {
              const def = String(it.sense.definition || '').trim();
              if (def) {
                if (!itOrigin && it.sense.origin) itOrigin = it.sense.origin;
                itemSenses.push({
                  senseNo: it.sense.sense_no || 1,
                  definition: def,
                  pos: itPos,
                  origin: it.sense.origin || itOrigin || '표준어',
                  type: it.sense.type || '일반어',
                  link: it.sense.link || `https://stdict.korean.go.kr`,
                });
              }
            }

            const definitions = itemSenses.map((s, sIdx) => `${sIdx + 1}. ${s.definition}`);
            const primaryMeaning = itemSenses[0]?.definition || '국립국어원 표준국어대사전 등재 단어';

            return {
              id: `${cleanWord}-${supNo || idx}-${it.target_code || idx}`,
              word: cleanWord,
              supNo: supNo,
              pos: itPos,
              meaning: primaryMeaning,
              definitions: definitions.length > 0 ? definitions : [primaryMeaning],
              senses: itemSenses,
              length: cleanWord.length,
              firstChar: cleanWord[0],
              lastChar: cleanWord[cleanWord.length - 1],
              origin: itOrigin || '표준어',
              targetCode: it.target_code,
              source: 'STDICT' as const,
            };
          })
          .filter(Boolean);

        return res.json({
          words: formattedWords,
          page,
          hasMore: true,
        });
      }
    }

    res.json({ words: [], page, hasMore: false });
  } catch (e: any) {
    res.json({ words: [], page, hasMore: false });
  }
});

// Start server with Vite middleware (Dev) or Static files (Prod)
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`끝잇기 서버가 포트 ${PORT}에서 정상 실행 중입니다.`);
  });
}

startServer();
