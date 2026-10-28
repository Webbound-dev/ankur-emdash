// Interface text written into the templates rather than stored in EmDash
// (breadcrumbs, form placeholders and messages, button and map labels), plus
// the fixed lists the content keeps in English because code matches on them
// (blog categories, export countries). Keyed by the English text, so a string
// without a Hindi entry simply stays English. `{name}` marks a value filled in
// by t(): t(locale, 'Page {current} of {total}', { current: 2, total: 5 }).
import { toLocale, type Locale } from './i18n';

const hi: Record<string, string> = {
  // Breadcrumbs
  'Home': 'होम',
  'Blog': 'ब्लॉग',
  'About Us': 'हमारे बारे में',
  'Consumable Salt': 'खाने का नमक',
  'Champalal Group': 'चंपालाल ग्रुप',
  'Breadcrumb': 'आप यहाँ हैं',

  // Blog categories
  'Health & Nutrition': 'सेहत और पोषण',
  'Manufacturing & Quality': 'उत्पादन और क्वालिटी',
  'Export & Trade': 'एक्सपोर्ट और व्यापार',
  'Company News': 'कंपनी की खबरें',
  'Recipes': 'रेसिपी',

  // Export countries
  'United Arab Emirates': 'संयुक्त अरब अमीरात',
  'Oman': 'ओमान',
  'Kuwait': 'कुवैत',
  'Saudi Arabia': 'सऊदी अरब',
  'Sierra Leone': 'सिएरा लियोन',
  'Tanzania': 'तंज़ानिया',
  'Djibouti': 'जिबूती',
  'Ethiopia': 'इथियोपिया',
  'Mauritius': 'मॉरीशस',
  'Réunion': 'रियूनियन',
  'Nepal': 'नेपाल',
  'Bangladesh': 'बांग्लादेश',
  'Sri Lanka': 'श्रीलंका',
  'Malaysia': 'मलेशिया',
  'Philippines': 'फ़िलीपींस',
  'Singapore': 'सिंगापुर',
  'Papua New Guinea': 'पापुआ न्यू गिनी',

  // Navigation and carousels
  'Open menu': 'मेन्यू खोलें',
  'Close menu': 'मेन्यू बंद करें',
  'Switch to Hindi': 'हिंदी में देखें',
  'Switch to English': 'अंग्रेज़ी में देखें',
  'Close': 'बंद करें',
  'Previous video': 'पिछला वीडियो',
  'Next video': 'अगला वीडियो',
  'Previous image': 'पिछली फ़ोटो',
  'Next image': 'अगली फ़ोटो',
  'Previous page': 'पिछला पेज',
  'Next page': 'अगला पेज',
  'Previous article': 'पिछला लेख',
  'Next article': 'अगला लेख',
  'Previous milestone': 'पिछला पड़ाव',
  'Next milestone': 'अगला पड़ाव',
  'Show slide {n}': 'स्लाइड {n} दिखाएँ',
  'Play track {n}': 'ट्रैक {n} चलाएँ',
  'Blog pagination': 'ब्लॉग के पेज',
  'Page {current} of {total}': 'पेज {current} / {total}',
  'On this page': 'इस पेज पर',
  'Scroll': 'नीचे देखें',
  'View': 'देखें',
  'View full details': 'पूरी जानकारी देखें',
  'Read more': 'और पढ़ें',
  'Read less': 'कम पढ़ें',
  'Visit Website': 'वेबसाइट देखें',

  // Labels
  'Est.': 'स्थापना',
  'Founded': 'स्थापना',
  'Headquarters': 'मुख्यालय',
  'Countries': 'देश',
  'Regions': 'क्षेत्र',
  'All': 'सभी',
  'Certifications and awards': 'सर्टिफ़िकेट और अवॉर्ड',
  "Map of Ankur's distribution across India": 'पूरे भारत में अंकुर की पहुँच का नक्शा',
  "Map of Ankur's distributor network across India": 'पूरे भारत में अंकुर के डिस्ट्रीब्यूटर नेटवर्क का नक्शा',
  'Map of countries Ankur Salt exports to': 'उन देशों का नक्शा जहाँ अंकुर साल्ट एक्सपोर्ट होता है',
  'Sound on': 'आवाज़ चालू',
  'Sound off': 'आवाज़ बंद',
  'Mute site audio': 'साइट की आवाज़ बंद करें',
  'Unmute site audio': 'साइट की आवाज़ चालू करें',
  'Ankur Namak, Asli Namak': 'अंकुर नमक, असली नमक',
  'Ankur Namak, Asli Namak (Reprise)': 'अंकुर नमक, असली नमक (रीप्राइज़)',

  // Forms
  'Your name': 'आपका नाम',
  'Your company': 'आपकी कंपनी',
  'Select a team': 'टीम चुनें',
  'Select a reason': 'वजह चुनें',
  'Select industry': 'इंडस्ट्री चुनें',
  'Select grade': 'ग्रेड चुनें',
  'Please specify your industry': 'अपनी इंडस्ट्री बताएँ',
  'Please specify your grade': 'अपना ग्रेड बताएँ',
  'City, state / country': 'शहर, राज्य / देश',
  "Tell us what's on your mind": 'बताइए, आप क्या कहना चाहते हैं',
  "A little about your background and why you're interested": 'अपने बारे में थोड़ा बताइए और यह भी कि आप क्यों जुड़ना चाहते हैं',
  'Any additional details about your requirement': 'आपकी ज़रूरत के बारे में कोई और जानकारी',
  'Close application form': 'आवेदन फ़ॉर्म बंद करें',
  'Apply anyway': 'फिर भी आवेदन करें',
  'Bulk Enquiry Form': 'थोक ऑर्डर पूछताछ फ़ॉर्म',
  'Submit Request': 'अनुरोध भेजें',
  'Send OTP': 'OTP भेजें',
  'Send Code': 'कोड भेजें',
  'Resend': 'फिर से भेजें',
  'Verify': 'वेरिफ़ाई करें',
  'Verify & Download': 'वेरिफ़ाई करें और डाउनलोड करें',
  'Sending…': 'भेजा जा रहा है…',
  'Submitting…': 'भेजा जा रहा है…',
  'Verifying…': 'वेरिफ़ाई हो रहा है…',
  'Enter a valid email address first.': 'पहले सही ईमेल पता डालें।',
  'Incorrect code. Please try again.': 'कोड सही नहीं है। कृपया फिर से कोशिश करें।',
  'Something went wrong. Please try again.': 'कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।',
  'Failed to submit': 'भेजा नहीं जा सका। कृपया फिर से कोशिश करें।',
  'Failed to submit request': 'अनुरोध भेजा नहीं जा सका। कृपया फिर से कोशिश करें।',
  'Failed to submit application': 'आवेदन भेजा नहीं जा सका। कृपया फिर से कोशिश करें।',
  'Failed to submit your application': 'आपका आवेदन भेजा नहीं जा सका। कृपया फिर से कोशिश करें।',
  'Failed to send verification code': 'वेरिफ़िकेशन कोड नहीं भेजा जा सका',
};

export function t(locale: Locale, english: string, vars?: Record<string, string | number>): string {
  let text = locale === 'hi' ? (hi[english] ?? english) : english;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, String(value));
  return text;
}

/** In a page's client-side script: the language of the page (its <html lang>). */
export function pageLocale(): Locale {
  return toLocale(document.documentElement.lang);
}
