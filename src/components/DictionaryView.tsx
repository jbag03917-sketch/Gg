import React, { useState } from 'react';
import { Search, Sparkles, BookOpen, Flame, Zap, HelpCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { DictionaryWord } from '../types';
import { DICTIONARY_DATABASE, searchDictionaryWords, checkWordInDictionary } from '../lib/dictionaryData';
import { getValidStartingChars } from '../lib/hangulRules';
import { sounds } from '../lib/soundEffects';

interface DictionaryViewProps {
  initialSearch?: string;
}

export const DictionaryView: React.FC<DictionaryViewProps> = ({ initialSearch = '' }) => {
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'RARE' | 'ATTACK'>('ALL');
  const [selectedWord, setSelectedWord] = useState<DictionaryWord | null>(
    DICTIONARY_DATABASE[0] || null
  );

  // Custom word test tool state
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<{ checked: boolean; valid?: boolean; info?: DictionaryWord; reason?: string }>({
    checked: false,
  });

  const words = searchDictionaryWords(searchQuery, activeFilter);

  const handleTestWord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testInput.trim()) return;
    const res = await checkWordInDictionary(testInput.trim());
    setTestResult({
      checked: true,
      valid: res.isValid,
      info: res.wordInfo,
      reason: res.reason,
    });
    if (res.isValid) {
      sounds.playCorrect();
      if (res.wordInfo) setSelectedWord(res.wordInfo);
    } else {
      sounds.playWrong();
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      {/* Header Banner */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-bold text-xs">
              공식 사전
            </span>
            <h1 className="font-black text-2xl sm:text-3xl text-[#1e2022]">
              단어 사전
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            게임에 사용되는 표준 단어와 두음법칙 연결, 희귀 단어를 검색해보세요.
          </p>
        </div>

        {/* Word Inspector Form */}
        <form onSubmit={handleTestWord} className="w-full md:w-auto flex gap-2">
          <input
            type="text"
            value={testInput}
            onChange={(e) => {
              setTestInput(e.target.value);
              setTestResult({ checked: false });
            }}
            placeholder="단어 유효성 검사 (예: 차축, 개나리)"
            className="px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium min-w-[220px]"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e2022] hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shrink-0 cursor-pointer"
          >
            검사
          </button>
        </form>
      </div>

      {/* Test Result Alert if checked */}
      {testResult.checked && (
        <div
          className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between animate-in fade-in duration-150 ${
            testResult.valid
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            <span>
              {testResult.valid
                ? `✓ "${testInput}" 은(는) 끝잇기 게임에서 사용할 수 있는 정상 단어입니다!`
                : `✕ "${testInput}" 은(는) ${testResult.reason || '사용할 수 없는 단어입니다.'}`}
            </span>
          </div>
          {testResult.info && (
            <span className="text-[11px] font-semibold text-emerald-700 bg-white/80 px-2 py-0.5 rounded-md">
              {testResult.info.pos} · {testResult.info.length}글자
            </span>
          )}
        </div>
      )}

      {/* Main Grid: Search & List (Left) + Detail View (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Search & Filter List */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-col gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="단어 검색 (예: 자동차, 과자, 리, 녀...)"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 text-xs font-semibold"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  activeFilter === 'ALL'
                    ? 'bg-[#1e2022] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                전체 단어 ({DICTIONARY_DATABASE.length})
              </button>
              <button
                onClick={() => setActiveFilter('RARE')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                  activeFilter === 'RARE'
                    ? 'bg-purple-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Flame className="w-3 h-3 text-amber-500" />
                <span>🔥 희귀 단어</span>
              </button>
              <button
                onClick={() => setActiveFilter('ATTACK')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                  activeFilter === 'ATTACK'
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Zap className="w-3 h-3 text-yellow-400" />
                <span>⚡ 한방 단어</span>
              </button>
            </div>
          </div>

          {/* Words List */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[480px] overflow-y-auto">
            {words.map((item) => {
              const isSelected = selectedWord?.word === item.word;
              const dueums = getValidStartingChars(item.lastChar);

              return (
                <button
                  key={item.word}
                  onClick={() => {
                    setSelectedWord(item);
                    sounds.playPop();
                  }}
                  className={`p-3 rounded-xl text-left border transition-all flex flex-col justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-purple-50/80 border-purple-400 shadow-xs'
                      : 'bg-white hover:bg-slate-50 border-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-[#1e2022]">
                        {item.word}
                      </span>
                      {item.isRare && (
                        <span className="px-1.5 py-0.2 bg-purple-100 text-purple-700 text-[9px] font-extrabold rounded">
                          희귀
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {item.usageCount.toLocaleString()}회
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-500 font-medium line-clamp-1">
                    {item.meaning}
                  </p>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100/60 text-[10px] text-slate-400 font-medium">
                    <span>끝: 「{item.lastChar}」</span>
                    {dueums.length > 1 && (
                      <span className="text-purple-600 font-bold">
                        두음 {dueums.join('/')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right 1 Col: Selected Word Deep Inspection (Section 6 style) */}
        <div className="flex flex-col gap-4">
          {selectedWord ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 flex flex-col gap-4 sticky top-24">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-xs font-bold text-slate-400">단어 정보</span>
                <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-extrabold text-xs">
                  {selectedWord.pos}
                </span>
              </div>

              <div>
                <h3 className="font-black text-3xl text-purple-800 tracking-tight mb-2">
                  {selectedWord.word}
                </h3>
                <p className="text-xs text-slate-600 font-medium leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  {selectedWord.meaning}
                </p>
              </div>

              {/* Stats Spec Table */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold mb-0.5">글자 수</div>
                  <div className="font-bold text-[#1e2022]">{selectedWord.length}글자</div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold mb-0.5">어휘 종류</div>
                  <div className="font-bold text-[#1e2022]">{selectedWord.origin || '표준어'}</div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold mb-0.5">첫 글자</div>
                  <div className="font-bold text-purple-700">「{selectedWord.firstChar}」</div>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold mb-0.5">끝 글자</div>
                  <div className="font-bold text-indigo-700">「{selectedWord.lastChar}」</div>
                </div>
              </div>

              {/* Dueum rule inspection */}
              {(() => {
                const dueums = getValidStartingChars(selectedWord.lastChar);
                return (
                  <div className="bg-purple-50/60 p-3 rounded-xl border border-purple-100">
                    <div className="text-[11px] font-bold text-purple-900 mb-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-600" />
                      <span>다음 차례 연결 가능 음절</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {dueums.map((char) => (
                        <span
                          key={char}
                          className="px-2 py-0.5 bg-white text-purple-800 font-black text-xs rounded-md shadow-2xs border border-purple-200"
                        >
                          「{char}」
                        </span>
                      ))}
                      {dueums.length > 1 && (
                        <span className="text-[10px] text-purple-700 font-semibold">
                          (두음법칙 적용)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-between text-xs font-bold pt-2 border-t border-slate-100 text-slate-500">
                <span>게임 내 총 사용 횟수</span>
                <span className="font-mono text-purple-700 font-black">
                  {selectedWord.usageCount.toLocaleString()}회
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 text-center text-slate-400 text-xs">
              단어를 선택하면 상세 정보가 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
