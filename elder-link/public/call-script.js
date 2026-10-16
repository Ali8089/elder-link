// The Elder Link care-call script, as a branching conversation tree.
//
// Source: ElderLink_Call_Script.md (English + 粵語), sections S1–S44.
// This is the plain-JS mirror used by the standalone phone call screen
// (public/phone-call.html). The React app reads src/lib/script.ts; keeping the
// tree here means the phone page needs no bundler and no build step.
//
// Shape of a node:
//   { id, say: [{zh, en}], options: [{zh, en, go}], next, end }
//
//   say      lines the AI speaks, in order
//   options  what the elder may choose; `go` is the next section id
//   next     continue to this section when there are no options to wait on
//   end      the call finishes after `say`
//
// The safety rules from the markdown are encoded in the graph itself:
//   * unclear is asked once more, then escalated (S12 → S13/S14)
//   * immediate danger always advises 999 and always escalates (S5, S6)
//   * the AI never claims it called 999 (S8)
//   * one activity per call, never any pressure (S34–S38)

// BEGIN GENERATED SCRIPT — produced by scripts/gen-script-from-md.mjs
// Do not edit by hand: run the generator instead. Source: ElderLink_Call_Script.md
export const CALLER_NAME = "Elderly care team";

/** The elder and her people, from the script's sample cast. */
export const CAST = {
  elder: { zh: "陳婆婆", en: "Mrs Chan" },
  daughter: { zh: "家欣", en: "Ka Yan" },
  nephew: { zh: "偉文", en: "Wai Man" },
  socialWorker: { zh: "李姑娘", en: "Ms Lee" },
  operator: { zh: "黃生", en: "Mr Wong" },
  centre: { zh: "樂安長者中心", en: "Lok On Elderly Centre" },
};

const s = (zh, en) => ({ zh, en });
const o = (zh, en, go) => ({ zh, en, go });

export const SCRIPT = {
  S1: {
    id: "S1",
    title: "Scheduled check-in call / 定期關懷電話",
    say: [
      s("喂，陳婆婆你好呀！我係 Elder Link，樂安長者中心嘅 AI 關懷電話。",
        "Hello Mrs Chan! This is Elder Link, the AI care caller from Lok On Elderly Centre."),
      s("照舊提提你：我係電腦，唔係真人。我永遠唔會問你要錢、銀行資料或者身份證號碼。",
        "A quick reminder: I'm a computer, not a person. I will never ask for money, bank details or your ID card number."),
      s("你今日覺得點呀？",
        "How are you feeling today?"),
    ],
    next: "S3",
  },
  S2: {
    id: "S2",
    title: "Sensor alert call / 感應器警報電話",
    say: [
      s("喂，陳婆婆，我係 Elder Link，樂安長者中心嘅 AI 關懷電話。",
        "Hello Mrs Chan, this is Elder Link, the AI care caller from Lok On Elderly Centre."),
      s("你屋企門口個感應器話今日未開過門，所以我打嚟問候下你。",
        "Your door sensor shows the door hasn't opened today, so I'm calling to check on you."),
      s("我係電腦，唔係真人，唔會問你要錢或者身份證號碼。你而家好唔好呀？",
        "I'm a computer, not a person, and I won't ask for money or your ID number. Are you all right?"),
    ],
    next: "S3",
  },
  S3: {
    id: "S3",
    ask: "你今日覺得點呀？",
    say: [
    ],
    options: [
      o("唔係幾舒服……", "Not feeling well… [Sick]", "S4"),
      o("都幾好，不過成日一個人，好悶。", "Fine, but I'm always alone. It's boring. [Lonely]", "S15"),
      o("肚餓呀，今日仲未食嘢。", "I'm hungry. I haven't eaten today. [Hungry]", "S25"),
      o("幾好呀！", "I'm good! [Doing well]", "S34"),
    ],
  },
  S4: {
    id: "S4",
    say: [
      s("聽到你唔舒服，我有啲擔心。你邊度唔舒服呀？",
        "I'm sorry you're unwell. Where do you feel unwell?"),
    ],
    options: [
      o("心口好痛，好難透氣。", "My chest hurts and I can hardly breathe.", "S5"),
      o("我喺廁所跌親，起唔到身。", "I fell in the bathroom and can't get up.", "S6"),
      o("有啲咳，喉嚨痛，好似有少少發燒。", "A bit of a cough, sore throat, maybe a slight fever.", "S9"),
      o("唔……唔知呀……", "Um… I don't know…", "S12"),
    ],
  },
  S5: {
    id: "S5",
    danger: true,
    say: [
      s("陳婆婆，心口痛同透唔到氣可能好危險。",
        "Mrs Chan, chest pain and trouble breathing can be very dangerous."),
      s("請你而家即刻打999叫救護車。",
        "Please call 999 for an ambulance right now."),
      s("我而家同時通知緊你女兒同中心職員，佢哋會好快打俾你。",
        "At the same time, I'm alerting your daughter and the centre staff. They will call you very soon."),
      s("你打唔打到999呀？",
        "Are you able to call 999?"),
    ],
    options: [
      o("打到，我而家打。", "Yes, I'll call now.", "S7"),
      o("我郁唔到……", "I can't move…", "S8"),
    ],
  },
  S6: {
    id: "S6",
    danger: true,
    say: [
      s("陳婆婆，唔好勉強自己起身。",
        "Mrs Chan, don't force yourself to get up."),
      s("如果你攞到電話，請即刻打999叫救護車。",
        "If you can reach the phone, please call 999 for an ambulance right now."),
      s("我而家通知緊你女兒同中心職員，佢哋會好快聯絡你。",
        "I'm alerting your daughter and the centre staff now. They will contact you very soon."),
      s("你打唔打到999呀？",
        "Are you able to call 999?"),
    ],
    options: [
      o("打到，我而家打。", "Yes, I'll call now.", "S7"),
      o("我郁唔到……", "I can't move…", "S8"),
    ],
  },
  S7: {
    id: "S7",
    danger: true,
    say: [
      s("好，你而家收線打999。",
        "OK, hang up now and call 999."),
      s("你女兒已經收到通知。保持冷靜，救護員好快到。",
        "Your daughter has been told. Stay calm. The ambulance crew will be there soon."),
    ],
    end: true,
  },
  S8: {
    id: "S8",
    danger: true,
    say: [
      s("唔緊要，你唔好郁。",
        "That's OK. Stay still."),
      s("我已經即刻叫緊真人同事處理，佢會決定點樣幫你，包括叫救護車。",
        "I'm getting a human colleague on this right now. They will decide how to help you, including calling an ambulance."),
      s("如果有人經過，你大聲叫佢幫手。",
        "If anyone is nearby, call out to them for help."),
    ],
    end: true,
  },
  S9: {
    id: "S9",
    say: [
      s("我唔係醫生，唔可以同你診症。",
        "I'm not a doctor, so I can't tell you what's wrong."),
      s("不過咳同發燒，最好俾醫生睇下。普通科門診有長者預留籌，可以打電話或者用 HA Go 預約。",
        "But with a cough and fever, it's best to see a doctor. General outpatient clinics keep places for elders, and you can book by phone or with the HA Go app."),
      s("你想唔想我叫你女兒今日打俾你，幫你約醫生？",
        "Would you like me to ask your daughter to call you today and help you book?"),
    ],
    options: [
      o("好呀，唔該你。", "Yes please.", "S10"),
      o("唔使喇，唔想麻煩佢。", "No, I don't want to bother her.", "S11"),
    ],
  },
  S10: {
    id: "S10",
    danger: true,
    say: [
      s("好，我而家通知你女兒。",
        "OK, I'm letting your daughter know now."),
      s("如果突然好難透氣或者好辛苦，記住即刻打999。",
        "If you suddenly find it hard to breathe or feel much worse, call 999 straight away."),
      s("我聽日再打俾你，睇下你好啲未。",
        "I'll call you again tomorrow to see how you are."),
    ],
    next: "S40",
  },
  S11: {
    id: "S11",
    say: [
      s("明白，你唔想麻煩人。",
        "I understand. You don't want to trouble anyone."),
      s("因為你唔舒服，我哋一定要有真人跟進。我會請中心嘅李姑娘今日打俾你，佢會幫你諗下點去睇醫生，唔會即刻麻煩你女兒。",
        "Because you're unwell, a person has to follow up. I'll ask Ms Lee at the centre to call you today. She can help you work out how to see a doctor, without troubling your daughter."),
      s("如果突然好辛苦，記住即刻打999。",
        "If you suddenly feel much worse, call 999 straight away."),
    ],
    next: "S40",
  },
  S12: {
    id: "S12",
    say: [
      s("唔好意思，我聽得唔係好清楚。你係咪覺得唔舒服呀？",
        "Sorry, I didn't quite catch that. Are you feeling unwell?"),
    ],
    options: [
      o("係……頭暈暈哋。", "Yes… I feel dizzy.", "S13"),
      o("唔……", "Um…", "S14"),
    ],
  },
  S13: {
    id: "S13",
    say: [
      s("多謝你話我知。頭暈嘅話，先坐低或者瞓低，唔好急住行。",
        "Thank you for telling me. If you feel dizzy, sit or lie down and don't rush to walk around."),
      s("我而家通知你女兒打俾你。如果好辛苦或者跌親，即刻打999。",
        "I'm asking your daughter to call you now. If you feel very bad or you fall, call 999 straight away."),
    ],
    next: "S40",
  },
  S14: {
    id: "S14",
    say: [
      s("陳婆婆，我而家請你屋企人同中心職員聯絡你，佢哋好快會打俾你。如果有危險，請打999。",
        "Mrs Chan, I'm asking your family and the centre staff to contact you. They will call you soon. If you are in danger, please call 999."),
    ],
    end: true,
  },
  S15: {
    id: "S15",
    say: [
      s("一個人住，悶係好正常嘅，多謝你肯話俾我知。",
        "Living alone, feeling bored is very normal. Thank you for telling me."),
      s("你平時最鍾意做啲咩呀？",
        "What do you like doing most?"),
    ],
    options: [
      o("我以前好鍾意唱粵曲。", "I used to love singing Cantonese opera.", "S16"),
      o("想有個人上嚟同我傾下偈。", "I wish someone would come up and chat with me.", "S20"),
      o("冇咩鍾意……覺得活落去都冇意思。", "Nothing really… I feel there's no point living.", "S23"),
    ],
  },
  S16: {
    id: "S16",
    say: [
      s("嘩，粵曲！你最鍾意邊首呀？",
        "Oh, Cantonese opera! Which song is your favourite?"),
    ],
    options: [
      o("《帝女花》呀，以前成日同老公一齊唱。", "\"The Flower Princess\". I used to sing it with my husband.", "S17"),
    ],
  },
  S17: {
    id: "S17",
    activity: true,
    say: [
      s("聽落好溫馨。",
        "That sounds lovely."),
      s("樂安長者中心逢星期四下晝兩點有粵曲班，大家一齊唱，免費參加。",
        "Lok On Elderly Centre has a Cantonese opera class every Thursday at 2 pm. Everyone sings together, and it's free."),
      s("你想唔想我請中心李姑娘打俾你，講多啲？",
        "Would you like Ms Lee from the centre to call you and tell you more?"),
    ],
    options: [
      o("好呀，我想試下。", "Yes, I'd like to try.", "S18"),
      o("我諗下先。", "Let me think about it.", "S19"),
    ],
  },
  S18: {
    id: "S18",
    activity: true,
    say: [
      s("好！我話俾李姑娘知，佢會打俾你。下次見面可以唱《帝女花》俾大家聽喇！",
        "Great! I'll tell Ms Lee and she'll call you. Maybe you can sing \"The Flower Princess\" for everyone!"),
    ],
    next: "S39",
  },
  S19: {
    id: "S19",
    say: [
      s("冇問題，你慢慢諗。你想去嘅時候話我知就得。",
        "No problem, take your time. Just tell me whenever you'd like to go."),
    ],
    next: "S39",
  },
  S20: {
    id: "S20",
    activity: true,
    say: [
      s("有人陪下傾偈真係好開心。",
        "Having someone to chat with really helps."),
      s("你住嗰區有地區關愛隊，佢哋嘅義工會上門探長者。",
        "Your district has a Care Team, and its volunteers visit elders at home."),
      s("你想唔想我請中心安排義工上嚟探你？",
        "Would you like me to ask the centre to arrange a volunteer visit?"),
    ],
    options: [
      o("好呀！", "Yes, please!", "S21"),
      o("唔好喇，我唔慣陌生人。", "No, I'm not used to strangers.", "S22"),
    ],
  },
  S21: {
    id: "S21",
    activity: true,
    say: [
      s("好！我話俾中心知，佢哋會打俾你約時間。義工嚟之前會先打電話俾你。",
        "Great! I'll let the centre know and they'll call you to set a time. The volunteer will always phone you before coming."),
    ],
    next: "S39",
  },
  S22: {
    id: "S22",
    say: [
      s("明白。咁我照舊每隔兩三日打嚟同你傾下偈，好唔好？",
        "I understand. Then I'll keep calling every two or three days for a chat. Is that OK?"),
    ],
    next: "S39",
  },
  S23: {
    id: "S23",
    unsafe: true,
    say: [
      s("陳婆婆，多謝你肯同我講，你嘅感受好重要。",
        "Mrs Chan, thank you for telling me. How you feel matters a lot."),
      s("我而家請一位真人同事打俾你，同你傾下。",
        "I'm asking a human colleague to call you now and talk with you."),
      s("如果你覺得有危險，或者想傷害自己，請即刻打999。",
        "If you feel in danger or want to hurt yourself, please call 999 right away."),
      s("你亦都可以隨時打 18111，24小時都有人聽你講。",
        "You can also call 18111 at any time. Someone answers 24 hours a day."),
    ],
    options: [
      o("好……多謝你。", "OK… thank you.", "S24"),
    ],
  },
  S24: {
    id: "S24",
    unsafe: true,
    say: [
      s("唔使客氣。黃生好快會打俾你。你唔係一個人。",
        "You're welcome. Mr Wong will call you very soon. You are not alone."),
    ],
    end: true,
  },
  S25: {
    id: "S25",
    say: [
      s("肚餓就要食嘢喇！你屋企有冇嘢食呀？",
        "If you're hungry, you should eat! Do you have food at home?"),
    ],
    options: [
      o("有米同雞蛋，不過懶得煮。", "I've got rice and eggs, but I can't be bothered to cook.", "S26"),
      o("冇呀，雪櫃空晒。", "No, the fridge is empty.", "S30"),
      o("好幾日都冇胃口，食唔落。", "I've had no appetite for days. I can't eat.", "S33"),
    ],
  },
  S26: {
    id: "S26",
    say: [
      s("我諗幾個簡單嘢俾你：",
        "Here are a few easy ideas:"),
      s("蒸個水蛋，十分鐘就得，又滑又易食。",
        "A steamed egg custard. It takes ten minutes and is soft and easy to eat."),
      s("或者煲個白粥，加隻蛋同少少菜，暖胃又飽肚。",
        "Or cook some plain congee with an egg and a few greens. Warm and filling."),
      s("你想食邊樣呀？",
        "Which one do you fancy?"),
    ],
    options: [
      o("蒸水蛋啦，簡單。", "Steamed egg. It's simple.", "S27"),
      o("其實想有人陪我食飯。", "Actually, I'd like someone to eat with.", "S28"),
    ],
  },
  S27: {
    id: "S27",
    say: [
      s("好選擇！記住蒸嘅時候小心熱水同蒸氣。",
        "Good choice! Be careful of the hot water and steam."),
      s("另外，樂安長者中心平日中午有午飯供應，想同人一齊食可以去。下次再話你知詳情。",
        "Also, Lok On Elderly Centre serves lunch on weekdays if you'd like to eat with others. I'll tell you more next time."),
    ],
    next: "S39",
  },
  S28: {
    id: "S28",
    say: [
      s("一齊食飯真係開心啲。",
        "Eating together really is nicer."),
      s("樂安長者中心平日中午有午飯供應，好多街坊一齊食。",
        "Lok On Elderly Centre serves lunch on weekdays, and many neighbours eat there together."),
      s("你想唔想我請中心打俾你，幫你留位？",
        "Would you like the centre to call you and save you a seat?"),
    ],
    options: [
      o("好呀！", "Yes please!", "S29"),
      o("今日先自己煮啦。", "I'll cook for myself today.", "S27"),
    ],
  },
  S29: {
    id: "S29",
    activity: true,
    say: [
      s("好！中心職員會打俾你。今日先蒸個水蛋頂住肚先啦。",
        "Great! The centre staff will call you. For today, how about a steamed egg to keep you going?"),
    ],
    next: "S39",
  },
  S30: {
    id: "S30",
    say: [
      s("雪櫃空晒會好唔方便。",
        "An empty fridge makes things hard."),
      s("中心社工可以幫手，例如安排送飯，或者申請短期食物援助。",
        "The centre's social worker can help, for example by arranging meal delivery or short-term food assistance."),
      s("我請李姑娘今日打俾你，好唔好？",
        "Shall I ask Ms Lee to call you today?"),
    ],
    options: [
      o("好呀，唔該你。", "Yes, thank you.", "S31"),
      o("唔使喇，我遲啲落街買。", "No need, I'll go out and buy something later.", "S32"),
    ],
  },
  S31: {
    id: "S31",
    activity: true,
    say: [
      s("好，李姑娘今日會打俾你。",
        "OK, Ms Lee will call you today."),
      s("佢嚟之前，如果樓下有茶餐廳或者街市，可以先買個飯盒或者麵包頂住肚。",
        "Until then, if there's a cha chaan teng or market downstairs, you could get a rice box or some bread to tide you over."),
    ],
    next: "S39",
  },
  S32: {
    id: "S32",
    say: [
      s("好，落街小心。後日我打嚟時再問你食咗乜。",
        "OK, take care when you go out. When I call the day after tomorrow, I'll ask what you ate."),
    ],
    next: "S39",
  },
  S33: {
    id: "S33",
    say: [
      s("幾日都食唔落，我有啲擔心你。",
        "Not eating for days worries me."),
      s("我唔係醫生，不過我會請你女兒今日打俾你，可能要搵醫生睇下。",
        "I'm not a doctor, but I'll ask your daughter to call you today. You may need to see a doctor."),
      s("如果覺得好虛弱或者頭暈，請即刻打999。",
        "If you feel very weak or dizzy, please call 999 straight away."),
    ],
    next: "S40",
  },
  S34: {
    id: "S34",
    say: [
      s("好開心聽到你精神好！",
        "I'm so glad you're feeling good!"),
      s("講你知，樂安長者中心呢個星期六朝早十點有「健康早操加茶聚」，免費，就喺你屋企隔兩條街。",
        "Lok On Elderly Centre has a \"morning exercise and tea\" gathering this Saturday at 10 am. It's free, and just two streets from your home."),
      s("你有冇興趣去呀？",
        "Would you like to go?"),
    ],
    options: [
      o("好呀，我想去！", "Yes, I'd like to go!", "S35"),
      o("我隻腳唔好，行唔到咁遠。", "My leg isn't good. I can't walk that far.", "S36"),
      o("唔去喇，我唔鍾意人多。", "No, I don't like crowds.", "S38"),
    ],
  },
  S35: {
    id: "S35",
    activity: true,
    say: [
      s("好！我話俾中心職員知，佢哋會打俾你確認。星期六見！",
        "Great! I'll tell the centre staff and they'll call you to confirm. See you Saturday!"),
    ],
    next: "S39",
  },
  S36: {
    id: "S36",
    say: [
      s("明白，行路唔方便。",
        "I understand, walking is hard."),
      s("中心可以安排義工陪你行過去，或者一齊搭車。你想唔想職員打俾你傾下？",
        "The centre can arrange a volunteer to walk with you or ride there together. Would you like the staff to call you to talk it over?"),
    ],
    options: [
      o("好，有人陪就去。", "OK, I'll go if someone comes with me.", "S37"),
      o("下次先啦。", "Maybe next time.", "S38"),
    ],
  },
  S37: {
    id: "S37",
    activity: true,
    say: [
      s("好！我話俾中心知你需要人陪，佢哋會打俾你約時間。",
        "Great! I'll tell the centre you'd like someone with you, and they'll call to arrange it."),
    ],
    next: "S39",
  },
  S38: {
    id: "S38",
    say: [
      s("冇問題，你話事。下次有細班啲嘅活動，我再話你知。",
        "No problem, it's your choice. Next time there's a smaller group activity, I'll let you know."),
    ],
    next: "S39",
  },
  S39: {
    id: "S39",
    say: [
      s("我後日星期五下晝三點再打俾你。",
        "I'll call you again the day after tomorrow, Friday, at 3 pm."),
      s("如果想改時間，或者唔想再收電話，隨時話我知。保重呀，拜拜！",
        "If you'd like a different time, or want the calls to stop, just tell me any time. Take care, bye!"),
    ],
    options: [
      o("好，拜拜！", "OK, bye!", null),
      o("可唔可以改做朝早打？", "Could you call in the morning instead?", "S41"),
    ],
  },
  S40: {
    id: "S40",
    say: [
      s("保重呀陳婆婆，拜拜。",
        "Take care, Mrs Chan. Goodbye."),
    ],
    end: true,
  },
  S41: {
    id: "S41",
    say: [
      s("冇問題，以後改做朝早十點打俾你。拜拜！",
        "No problem. From now on I'll call at 10 am. Bye!"),
    ],
    end: true,
  },
  S42: {
    id: "S42",
    title: "No answer / 冇人聽電話",
    say: [
      s("家欣你好，我係 Elder Link。我哋打咗兩次俾你媽媽陳婆婆，佢都冇聽。",
        "Hello Ka Yan, this is Elder Link. We called your mother, Mrs Chan, twice and she didn't answer."),
      s("你可唔可以而家聯絡佢，或者上去睇下佢？",
        "Could you contact her now, or go and check on her?"),
    ],
    options: [
      o("好，我而家打俾佢。", "OK, I'll call her now.", "S43"),
      o("（家欣都冇聽電話）", "(Ka Yan doesn't answer either)", "S44"),
    ],
  },
  S43: {
    id: "S43",
    say: [
      s("多謝你。你搵到媽媽之後，請喺短訊撳「已確認」。如果有危險，請即刻打999。",
        "Thank you. Once you reach your mother, please tap \"Confirmed\" in the text message. If she is in danger, call 999 straight away."),
    ],
    end: true,
  },
  S44: {
    id: "S44",
    say: [
    ],
    end: true,
  },
};

export const OPENING_FOR = { sensor: "S2", scheduled: "S1" };

/** Sections whose outcome must be escalated to a human. */
export const ESCALATE = new Set([
  "S5",
  "S6",
  "S7",
  "S8",
  "S9",
  "S10",
  "S11",
  "S12",
  "S13",
  "S14",
  "S23",
  "S24",
  "S33",
  "S42",
  "S43",
  "S44",
]);

/** The one-line note the dashboard records for a section, from the markdown. */
export const SYSTEM_NOTE = {
  S5: "Immediate danger heard. Approved 999 wording played.",
  S6: "Fall and cannot get up: immediate danger. Approved 999 wording played.",
  S10: "Worrying answer (unwell). Escalation starts within 60 s: AI voice call to daughter Ka Yan.",
  S11: "Worrying answer, but the elder asked not to bother family. A person must still follow up, so the centre social worker is called instead.",
  S12: "Unclear answer. Rule: repeat once, then escalate rather than guess.",
  S13: "Worrying answer (dizzy). Escalation within 60 s: AI voice call to daughter Ka Yan.",
  S14: "Still unclear after one repeat. Escalation within 60 s: daughter, then nephew, then operator. False alarms are accepted to avoid a false \"safe\".",
  S18: "Activity interest: Thursday opera class. Ms Lee (social worker) sees it on the dashboard and calls back.",
  S21: "Visit request passed to the centre, which arranges a Care Team volunteer visit.",
  S23: "Unsafe statement (no point living). Escalation starts at once; the human operator calls back.",
  S31: "Request for help (no food at home). Ms Lee, the social worker, is called within 60 s and follows up the same day. Elder Link asks nothing about money.",
  S33: "Worrying answer (not eating for days). Escalation within 60 s: AI voice call to daughter Ka Yan.",
  S35: "Activity interest: Saturday 10 am exercise and tea. Centre staff see it and call to confirm the place.",
  S37: "Activity interest with mobility note: needs an escort. Centre arranges a volunteer.",
  S42: "Scheduled call: rings 45 seconds, no answer.",
  S44: "First contact no answer. Step 2: second contact, nephew Wai Man.",
};
// END GENERATED SCRIPT
