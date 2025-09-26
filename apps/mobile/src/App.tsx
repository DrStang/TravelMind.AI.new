import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, FlatList, TouchableOpacity } from 'react-native';
import Constants from 'expo-constants';
import { startAutoSync } from './lib/sync';
import { useTodos } from './hooks/useTodos';

const API = (Constants?.expoConfig?.extra as any)?.apiUrl || 'http://96.30.194.54:3001';

export default function App() {
    const [tripId, setTripId] = useState('');
    const [msg, setMsg] = useState('');
    const [answer, setAnswer] = useState('');
    const { todos, refresh, toggle } = useTodos(tripId);

    useEffect(() => { startAutoSync(); }, []);
    useEffect(() => { if (tripId) refresh(); }, [tripId]);

    async function ask() {
        setAnswer('');
        const r = await fetch(`${API}/api/companion/ask`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'demo-user', tripId, message: msg })
        });
        const data = await r.json();
        setAnswer(data.answer);
    }

    return (
        <SafeAreaView style={{ flex: 1, padding: 16 }}>
            <Text style={{ fontSize: 22, fontWeight: '700' }}>TravelMind Companion</Text>

            <View style={{ marginTop: 16, gap: 8 }}>
                <TextInput placeholder="Enter Trip ID" value={tripId} onChangeText={setTripId} style={{ borderWidth: 1, borderRadius: 8, padding: 10 }} autoCapitalize="none" />
                <Button title="Refresh" onPress={refresh} />
            </View>

            <Text style={{ marginTop: 16, fontWeight: '600' }}>To-Do (offline-first)</Text>
            <FlatList data={todos} keyExtractor={(i) => i.id}
                      renderItem={({ item }) => (
                          <TouchableOpacity onPress={() => toggle(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                              <Text>{item.status === 'DONE' ? '✔' : '○'}</Text>
                              <Text>{item.title}</Text>
                          </TouchableOpacity>
                      )}
            />

            <Text style={{ marginTop: 16, fontWeight: '600' }}>Ask the on-trip assistant</Text>
            <TextInput placeholder="Find a pizza place nearby…" value={msg} onChangeText={setMsg} style={{ borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 8 }} />
            <TouchableOpacity onPress={ask} style={{ backgroundColor: 'black', padding: 12, borderRadius: 10, marginTop: 8 }}>
                <Text style={{ color: 'white', textAlign: 'center' }}>Ask</Text>
            </TouchableOpacity>
            {!!answer && <Text style={{ marginTop: 12 }}>{answer}</Text>}
        </SafeAreaView>
    );
}
