export interface Contact {
  address: string
  label: string
  pubX25519?: string
  pubEd25519?: string
  addedAt: number
}

const STORAGE_KEY = 'tmail_contacts'

export function getContacts(): Contact[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

export function saveContacts(contacts: Contact[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts))
}

export function addContact(address: string, label?: string): Contact[] {
  const contacts = getContacts()
  if (contacts.find(c => c.address === address)) return contacts
  const c: Contact = { address, label: label || address.slice(0, 10), addedAt: Date.now() }
  contacts.push(c)
  saveContacts(contacts)
  return contacts
}

export function removeContact(address: string): Contact[] {
  const contacts = getContacts().filter(c => c.address !== address)
  saveContacts(contacts)
  return contacts
}

export function updateContactPubkeys(address: string, pubX25519: string, pubEd25519: string) {
  const contacts = getContacts()
  const c = contacts.find(c => c.address === address)
  if (c) { c.pubX25519 = pubX25519; c.pubEd25519 = pubEd25519; saveContacts(contacts) }
}