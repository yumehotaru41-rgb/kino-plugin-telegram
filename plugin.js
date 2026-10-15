// Plugin de Kino para canales públicos de Telegram (apiVersion 7)
kino.onInit(async () => {
    return {
        name: "Telegram Public Streams",
        version: "1.0.0"
    };
});

kino.onCatalog(async (params) => {
    const defaultChannels = [
        { id: "cinema_hd_channel", name: "🎬 Cine y Videos Telegram", query: "cinema" },
        { id: "documentales_tg", name: "🌍 Documentales", query: "documental" },
        { id: "series_latino_tg", name: "📺 Clips y Series", query: "series" }
    ];

    let items = [];
    for (let ch of defaultChannels) {
        items.push({
            id: ch.id,
            type: "category",
            title: ch.name,
            poster: "https://telegram.org/img/t_logo.png"
        });
    }
    return { items };
});

kino.onSearch(async (query) => {
    const searchUrl = `https://t.me/s/${encodeURIComponent(query)}`;
    try {
        const response = await kino.fetch(searchUrl);
        const html = await response.text();
        
        const items = [];
        const postRegex = /<div class="tgme_widget_message_text[^>]*>(.*?)<\/div>/gs;
        
        let match;
        let idCounter = 1;
        
        while ((match = postRegex.exec(html)) !== null) {
            const textContent = match[1].replace(/<[^>]*>?/gm, '').trim();
            if (textContent.length > 0) {
                items.push({
                    id: `tg_item_${idCounter++}`,
                    type: "movie",
                    title: textContent.substring(0, 60) + (textContent.length > 60 ? "..." : ""),
                    description: textContent,
                    poster: "https://telegram.org/img/t_logo.png",
                    streams: [
                        {
                            title: "Reproducir Stream de Telegram",
                            url: `https://t.me/${encodeURIComponent(query)}`
                        }
                    ]
                });
            }
        }

        return { items };
    } catch (error) {
        return { items: [] };
    }
});

kino.onDetail(async (id) => {
    return {
        id: id,
        title: "Contenido de Telegram",
        description: "Reproduciendo transmisión pública obtenida desde Telegram.",
        streams: [
            {
                title: "Stream Principal",
                url: ""
            }
        ]
    };
});