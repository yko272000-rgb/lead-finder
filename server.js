const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Helper function to map frontend size numbers to Lusha V3 string ranges
function mapCompanySize(min, max) {
    const minVal = parseInt(min, 10) || 0;
    const maxVal = parseInt(max, 10) || Infinity;

    // Lusha V3 standard size buckets
    if (minVal >= 1 && maxVal <= 10) return "1-10";
    if (minVal >= 11 && maxVal <= 50) return "11-50";
    if (minVal >= 51 && maxVal <= 200) return "51-200";
    if (minVal >= 201 && maxVal <= 500) return "201-500";
    if (minVal >= 501 && maxVal <= 1000) return "501-1000";
    if (minVal >= 1001 && maxVal <= 5000) return "1001-5000";
    if (minVal >= 5001 && maxVal <= 10000) return "5001-10000";
    if (minVal >= 10001) return "10001+";

    // Dynamic fallback approximation if front-end ranges span multiple buckets
    if (minVal <= 50 && maxVal > 10) return "11-50";
    if (minVal <= 200 && maxVal > 50) return "51-200";
    
    return "11-50"; // Safe default production fallback
}

// Helper function to handle Lusha V3 business classification mapping
function mapIndustryKeywords(keyword) {
    if (!keyword) return [];
    
    const cleanKeyword = keyword.toLowerCase().trim();

    // Rule 4: Map common food/hospitality terms
    if (['coffee', 'restaurant', 'food', 'fish'].includes(cleanKeyword)) {
        return ["Food & Beverages", "Restaurants", "Retail"];
    }

    // Rule 4: Map common marketing/media terms
    if (['marketing', 'advertising', 'pr'].includes(cleanKeyword)) {
        return ["Marketing and Advertising", "Public Relations and Communications"];
    }

    // Rule 4 Fallback: If no match, return the raw search text as an array item
    return [keyword];
}

app.post('/api/find-leads', async (req, res) => {
    try {
        const { country, minSize, maxSize, keyword } = req.body;

        // Constructing the Lusha V3 Payload exactly to API specification
        const lushaPayload = {
            filters: {
                companies: {
                    include: {}
                }
            },
            // You can add pagination or standard fields here if required by your V3 flow
            page: 1,
            pageSize: 20 
        };

        // Rule 1: locations must be an object array: [{ country: country }]
        if (country) {
            lushaPayload.filters.companies.include.locations = [
                { country: country }
            ];
        }

        // Rule 2: sizes must be an array containing a mapped string range
        if (minSize || maxSize) {
            const mappedSizeString = mapCompanySize(minSize, maxSize);
            lushaPayload.filters.companies.include.sizes = [mappedSizeString];
        }

        // Rule 3 & 4: Business classification using industriesLabels and mapped keywords
        if (keyword) {
            const mappedLabels = mapIndustryKeywords(keyword);
            if (mappedLabels.length > 0) {
                lushaPayload.filters.companies.include.industriesLabels = mappedLabels;
            }
        }

        // Clear empty include objects if no filters were added to prevent API schema validation errors
        if (Object.keys(lushaPayload.filters.companies.include).length === 0) {
            delete lushaPayload.filters.companies;
        }

        // Axios request to Lusha V3 Prospecting Endpoint
        const response = await axios.post(
            'https://api.lusha.com/v3/prospecting/search', // Ensure this matches your exact Lusha regional base URL
            lushaPayload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.LUSHA_API_KEY}`
                }
            }
        );

        res.status(200).json(response.data);

    } catch (error) {
        console.error('Lusha API Error:', error.response?.data || error.message);
        
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch leads from Lusha V3 API',
            details: error.response?.data || error.message
        });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
