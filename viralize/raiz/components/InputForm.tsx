/// <reference lib="dom" />
import React, { useState } from 'react';
import { VideoInputData, DurationOption, TargetPlatform, MarketingGoal } from '../types';
import { Sparkles, ArrowRight, Zap, Search, ShieldCheck } from 'lucide-react';
import { fetchTrendingKeywords } from '../services/geminiService';

interface InputFormProps {
  onSubmit: (data: VideoInputData) => void;
  isGenerating: boolean;
  statusMessage?: string;
}

export const InputForm: React.FC<InputFormProps> = ({ onSubmit, isGenerating, statusMessage }) => {
  const [formData, setFormData] = useState<VideoInputData>({
    productName: '',
    description: '',
    targetAudience: '',
    duration: DurationOption.SHORT,
    platform: TargetPlatform.TIKTOK,
    marketingGoal: MarketingGoal.SALES,
    customKeywords: '',
    url: ''
  });
  
  const [loadingTrends, setLoadingTrends] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleFetchTrends = async () => {
      if (!formData.targetAudience && !formData.productName) {
          alert("Please enter a Product Name or Audience first.");
          return;
      }
      setLoadingTrends(true);
      const niche = formData.targetAudience || formData.productName;
      const trends = await fetchTrendingKeywords(niche);
      setFormData(prev => ({
          ...prev,
          customKeywords: trends.join(', ')
      }));
      setLoadingTrends(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="relative">
            <div className="absolute inset-0 bg-brand-500 blur-3xl opacity-20 rounded-full animate-pulse-fast"></div>
            <div className="w-24 h-24 border-4 border-brand-500 border-t-transparent rounded-full animate-spin relative z-10"></div>
            <div className="absolute inset-0 flex items-center justify-center z-10">
                <ShieldCheck className="text-brand-400 animate-pulse" size={32} />
            </div>
        </div>
        <div>
            <h2 className="text-3xl font-bold text-white mb-2">Analyzing & Creating...</h2>
            <p className="text-gray-400 text-lg">{statusMessage || "Checking Compliance & Optimizing SEO..."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
      {/* Glows */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-brand-600/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-accent-600/10 rounded-full blur-3xl"></div>

      <div className="relative z-10 mb-8 flex justify-between items-end">
        <div>
            <div className="inline-flex items-center gap-2 bg-brand-900/30 border border-brand-500/20 text-brand-400 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-4">
                <Zap size={14} />
                Phase 2: Intelligent
            </div>
            <h1 className="text-4xl font-black text-white mb-2 tracking-tight">Create Viral Campaign</h1>
            <p className="text-gray-400">AI-driven script generation with compliance & trend analysis.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
        {/* ROW 1 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Product / Brand</label>
            <input
              required
              name="productName"
              value={formData.productName}
              onChange={handleChange}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
              placeholder="e.g. SlimFit Pro"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Target Audience</label>
            <input
              required
              name="targetAudience"
              value={formData.targetAudience}
              onChange={handleChange}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
              placeholder="e.g. Fitness enthusiasts, 25-34"
            />
          </div>
        </div>

        {/* ROW 2: Description */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-300">Core Value / Description</label>
          <textarea
            required
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none"
            placeholder="Paste features, benefits, or a URL content..."
          />
        </div>

        {/* ROW 3: Strategy & SEO */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-gray-800/30 rounded-2xl border border-gray-800">
             <div className="space-y-2">
                <label className="text-sm font-semibold text-brand-400 flex items-center gap-2">
                    <Search size={14}/> Marketing Objective
                </label>
                <select
                  name="marketingGoal"
                  value={formData.marketingGoal}
                  onChange={handleChange}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 outline-none"
                >
                  <option value={MarketingGoal.SALES}>Direct Sales (High Conversion)</option>
                  <option value={MarketingGoal.TRAFFIC}>Traffic (Click-Through)</option>
                  <option value={MarketingGoal.ENGAGEMENT}>Engagement (Comments/Shares)</option>
                  <option value={MarketingGoal.AWARENESS}>Brand Awareness (Reach)</option>
                </select>
             </div>
             
             <div className="space-y-2 relative">
                <label className="text-sm font-semibold text-brand-400 flex items-center justify-between">
                    <span>SEO Keywords</span>
                    <button 
                        type="button"
                        onClick={handleFetchTrends}
                        disabled={loadingTrends}
                        className="text-xs bg-brand-600 hover:bg-brand-500 text-white px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
                    >
                        {loadingTrends ? 'Scanning...' : <><Sparkles size={10}/> Auto-Detect Trends</>}
                    </button>
                </label>
                <input
                  name="customKeywords"
                  value={formData.customKeywords}
                  onChange={handleChange}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 outline-none text-sm"
                  placeholder="e.g. #fitness, #homeworkout (Auto-filled by AI)"
                />
             </div>
        </div>

        {/* ROW 4: Platform & Format */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Platform</label>
            <select
              name="platform"
              value={formData.platform}
              onChange={handleChange}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 outline-none"
            >
              <option value={TargetPlatform.TIKTOK}>TikTok</option>
              <option value={TargetPlatform.REELS}>Instagram Reels</option>
              <option value={TargetPlatform.SHORTS}>YouTube Shorts</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Format</label>
            <div className="flex gap-4">
              <label className={`flex-1 cursor-pointer border rounded-xl p-3 flex items-center justify-center transition-all ${formData.duration === DurationOption.SHORT ? 'bg-brand-600 border-brand-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                <input type="radio" name="duration" value={DurationOption.SHORT} checked={formData.duration === DurationOption.SHORT} onChange={handleChange} className="hidden" />
                <span className="font-bold text-sm">15s (6 Scenes)</span>
              </label>
              <label className={`flex-1 cursor-pointer border rounded-xl p-3 flex items-center justify-center transition-all ${formData.duration === DurationOption.LONG ? 'bg-brand-600 border-brand-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                <input type="radio" name="duration" value={DurationOption.LONG} checked={formData.duration === DurationOption.LONG} onChange={handleChange} className="hidden" />
                <span className="font-bold text-sm">30s (10 Scenes)</span>
              </label>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="w-full group relative flex items-center justify-center gap-2 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white text-lg font-bold py-4 rounded-xl shadow-lg shadow-brand-900/50 transition-all transform hover:-translate-y-1"
        >
          <Sparkles size={20} className="group-hover:rotate-12 transition-transform" />
          Generate Compliant Campaign
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </form>
    </div>
  );
};
