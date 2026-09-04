// 1. MODULE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  push, 
  onValue, 
  off,
  query,
  limitToLast,
  update, 
  remove, 
  set, 
  get,
  onDisconnect,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. FIREBASE CONFIG & INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyA0BCPLt-9TvXtmPLCRq6Y45AijoUnkB48", 
  authDomain: "soroti-youth-forum.firebaseapp.com",
  projectId: "soroti-youth-forum",
  storageBucket: "soroti-youth-forum.firebasestorage.app",
  messagingSenderId: "1005832853294",
  appId: "1:1005832853294:web:bf61ea5749abf833688cbf",
  measurementId: "G-CHRVZQV6H6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);

// 3. GLOBAL STATE
let postsList = [];
let usersList = [];
let friendsList = [];
let userBookmarks = {};
let pendingRequests = [];
let sentRequests = [];
let currentUser = null;
let postsLimit = 25;
let currentPostsQueryRef = null;

// Modal Pagination & User State
let modalCurrentUid = null;
let modalPostsLimit = 5;

let activeChatRoom = null;
let activeChatRecipientUid = null;
let activeChatRecipientName = null;
let activeChatRef = null;
let activeChatCallback = null;
let activeTypingListenerRef = null;
let activeTypingListenerCallback = null;

let notifRef = null;
let notifCallback = null;
let friendsRef = null;
let friendsCallback = null;
let bookmarksRef = null;
let bookmarksCallback = null;
let requestsRef = null;
let requestsCallback = null;
let sentRequestsRef = null;
let sentRequestsCallback = null;
let connectedRef = null;
let connectedCallback = null;

let currentPostFile = null;
let currentChatFile = null;
let currentCallStream = null;

let typingTimeout = null;
let lastFocusedInput = null;

// 4. HELPER FUNCTIONS
function timeAgo(timestamp) {
  if (!timestamp) return 'Recently';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

async function compressImage(file, maxWidth = 1000, quality = 0.75) {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now()
          }));
        }, file.type, quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function uploadMediaFile(file, folderPath) {
  if (!file) return null;

  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB Limit
  if (file.size > MAX_SIZE_BYTES) {
    showToast("File size exceeds 5MB upload limit.");
    return null;
  }

  try {
    const fileToUpload = file.type.startsWith('image/') ? await compressImage(file) : file;
    const uniqueFileName = `${crypto.randomUUID()}_${fileToUpload.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const fileReference = storageRef(storage, `${folderPath}/${uniqueFileName}`);
    await uploadBytes(fileReference, fileToUpload);
    return await getDownloadURL(fileReference);
  } catch (error) {
    console.warn("Storage upload warning:", error);
    showToast("Cloud Storage upload failed.");
    return null;
  }
}

function getInitials(name) {
  return name ? name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2) : 'SY';
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function applyAvatarStyle(element, avatarUrl, name) {
  if (!element) return;
  if (avatarUrl) {
    element.style.backgroundImage = `url("${avatarUrl}")`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.textContent = '';
  } else {
    element.style.backgroundImage = 'none';
    element.textContent = getInitials(name);
  }
}

export async function sendNotification(targetUid, title, message, icon = 'fa-bell') {
  if (!targetUid) return;
  try {
    const targetNotifRef = ref(database, `notifications/${targetUid}`);
    await push(targetNotifRef, {
      title: title,
      message: message,
      icon: icon,
      read: false,
      createdAt: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    triggerDesktopPush(title, message);
  } catch (err) {
    console.warn("Could not dispatch notification:", err);
  }
}

function triggerDesktopPush(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "logo.png" });
  }
}

function showToast(message) {
  const toastNotice = document.getElementById('toastNotice');
  const toastText = document.getElementById('toastMsgText');
  if (!toastNotice || !toastText) return;
  toastText.innerHTML = message;
  toastNotice.style.display = 'flex';
  setTimeout(() => { toastNotice.style.display = 'none'; }, 4000);
}

function setupPresenceSystem(user) {
  if (!user) return;
  
  if (connectedRef && connectedCallback) {
    off(connectedRef, 'value', connectedCallback);
  }

  connectedRef = ref(database, ".info/connected");
  const userStatusRef = ref(database, `users/${user.uid}/isOnline`);
  const userLastSeenRef = ref(database, `users/${user.uid}/lastSeen`);

  connectedCallback = (snapshot) => {
    if (snapshot.val() === false) return;
    onDisconnect(userStatusRef).set(false).then(() => {
      onDisconnect(userLastSeenRef).set(serverTimestamp());
      set(userStatusRef, true);
      set(userLastSeenRef, serverTimestamp());
    });
  };

  onValue(connectedRef, connectedCallback);
}

function detachUserListeners() {
  if (notifRef && notifCallback) off(notifRef, 'value', notifCallback);
  if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
  if (bookmarksRef && bookmarksCallback) off(bookmarksRef, 'value', bookmarksCallback);
  if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
  if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
  if (connectedRef && connectedCallback) off(connectedRef, 'value', connectedCallback);
  if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);
  if (activeTypingListenerRef && activeTypingListenerCallback) off(activeTypingListenerRef, 'value', activeTypingListenerCallback);

  notifRef = null; notifCallback = null;
  friendsRef = null; friendsCallback = null;
  bookmarksRef = null; bookmarksCallback = null;
  requestsRef = null; requestsCallback = null;
  sentRequestsRef = null; sentRequestsCallback = null;
  connectedRef = null; connectedCallback = null;
  activeChatRef = null; activeChatCallback = null;
  activeTypingListenerRef = null; activeTypingListenerCallback = null;
}

function closeDrawer() {
  const navDrawer = document.getElementById('navDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  if (navDrawer) navDrawer.classList.remove('open');
  if (drawerOverlay) drawerOverlay.classList.remove('active');
}

// 5. GLOBAL INTERACTIVE WINDOW FUNCTIONS

// LIGHTBOX PHOTO VIEWER
window.openAvatarLightbox = function(avatarUrl, userName) {
  const lightboxModal = document.getElementById('avatarLightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxFallback = document.getElementById('lightboxFallbackAvatar');
  const lightboxName = document.getElementById('lightboxUserName');

  if (!lightboxModal) return;

  if (lightboxName) lightboxName.textContent = `${userName || 'Member'}'s Profile Picture`;

  if (avatarUrl) {
    if (lightboxImg) {
      lightboxImg.src = avatarUrl;
      lightboxImg.classList.remove('hidden');
    }
    if (lightboxFallback) lightboxFallback.classList.add('hidden');
  } else {
    if (lightboxImg) lightboxImg.classList.add('hidden');
    if (lightboxFallback) {
      lightboxFallback.classList.remove('hidden');
      lightboxFallback.style.backgroundImage = 'none';
      lightboxFallback.textContent = getInitials(userName);
    }
  }

  lightboxModal.classList.remove('hidden');
};

window.toggleBookmark = async function(button, postId) {
  if (!currentUser) {
    showToast("Please log in to bookmark posts.");
    return;
  }
  try {
    const bookmarkRef = ref(database, `users/${currentUser.uid}/bookmarks/${postId}`);
    const snapshot = await get(bookmarkRef);
    
    if (snapshot.exists()) {
      await remove(bookmarkRef);
      if (button) button.classList.remove('active');
      showToast("Bookmark removed.");
    } else {
      await set(bookmarkRef, Date.now());
      if (button) button.classList.add('active');
      showToast("Post bookmarked!");
    }
  } catch (err) {
    console.error("Failed to toggle bookmark:", err);
  }
};

window.triggerTypingStatus = function() {
  if (!currentUser || !activeChatRoom) return;
  const typingRef = ref(database, `typing/${activeChatRoom}/${currentUser.uid}`);
  set(typingRef, true);
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    set(typingRef, false);
  }, 2000);
};

window.toggleEmojiPicker = function(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('emoji-picker-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
};

window.insertEmoji = function(emoji) {
  const activeInput = lastFocusedInput || document.getElementById('chatInput') || document.getElementById('postText');
  if (activeInput) {
    const start = activeInput.selectionStart || 0;
    const end = activeInput.selectionEnd || 0;
    const text = activeInput.value;
    activeInput.value = text.substring(0, start) + emoji + text.substring(end);
    activeInput.selectionStart = activeInput.selectionEnd = start + emoji.length;
    activeInput.focus();
  }
  document.getElementById('emoji-picker-dropdown')?.classList.add('hidden');
};

window.markMessagesRead = async function(chatRoomId) {
  if (!currentUser || !chatRoomId) return;
  try {
    const chatRef = ref(database, `chats/${chatRoomId}`);
    const snapshot = await get(chatRef);
    if (snapshot.exists()) {
      const updates = {};
      Object.entries(snapshot.val()).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) {
          updates[`${msgId}/read`] = true;
        }
      });
      if (Object.keys(updates).length > 0) {
        await update(chatRef, updates);
      }
    }
  } catch (err) {
    console.error("Failed to mark messages read:", err);
  }
};

function renderModalUserPosts() {
  const container = document.getElementById('modalUserPostsContainer');
  const badge = document.getElementById('modalPostsCountBadge');
  if (!container) return;

  const userPosts = postsList.filter(p => p.uid === modalCurrentUid);
  if (badge) badge.textContent = `${userPosts.length} posts`;

  if (userPosts.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">No posts shared yet.</div>`;
    return;
  }

  const visiblePosts = userPosts.slice(0, modalPostsLimit);

  container.innerHTML = visiblePosts.map(post => {
    const displayTime = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');
    let attachmentHTML = '';
    if (post.attachment) {
      const type = post.attachmentType || '';
      if (type === 'image') {
        attachmentHTML = `<img src="${escapeHTML(post.attachment)}" style="width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin-top: 6px;" />`;
      } else if (type === 'video') {
        attachmentHTML = `<video src="${escapeHTML(post.attachment)}" controls style="width: 100%; max-height: 180px; border-radius: 6px; margin-top: 6px;"></video>`;
      }
    }

    return `
      <div class="modal-post-item" style="background: var(--item-hover-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; margin-bottom: 8px; text-align: left;">
        <div style="font-size: 11px; opacity: 0.6; margin-bottom: 4px;"><i class="fa-regular fa-clock"></i> ${escapeHTML(displayTime)}</div>
        ${post.content ? `<p style="font-size: 13px; line-height: 1.4; margin: 0;">${escapeHTML(post.content)}</p>` : ''}
        ${attachmentHTML}
      </div>
    `;
  }).join('');

  if (modalPostsLimit < userPosts.length) {
    container.innerHTML += `<div style="text-align: center; font-size: 11px; color: #888; padding: 8px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Scroll down to load more...</div>`;
  }
}

// OPEN USER PROFILE MODAL
window.openUserProfile = function(uid) {
  let user = usersList.find(u => u.uid === uid);
  
  if (!user && currentUser && currentUser.uid === uid) {
    user = currentUser;
  }

  if (!user) return;

  const modal = document.getElementById('profileModal');
  const nameEl = document.getElementById('modalProfileName');
  const emailEl = document.getElementById('modalProfileEmail');
  const avatarEl = document.getElementById('modalProfileAvatar');
  const statusEl = document.getElementById('modalProfileStatus');
  const postCountEl = document.getElementById('modalProfilePostCount');
  const actionsEl = document.getElementById('modalProfileActions');

  const displayName = user.displayName || user.name || 'Member';

  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = user.email || '';
  
  applyAvatarStyle(avatarEl, user.avatarUrl, displayName);

  // Attach Lightbox Zoom Click on Modal Avatar Image
  if (avatarEl) {
    avatarEl.onclick = () => window.openAvatarLightbox(user.avatarUrl, displayName);
  }

  if (statusEl) {
    statusEl.textContent = user.isOnline ? 'Online' : 'Offline';
    statusEl.className = `status-pill ${user.isOnline ? 'online' : 'offline'}`;
  }

  const userPosts = postsList.filter(p => p.uid === uid);
  if (postCountEl) postCountEl.textContent = userPosts.length;

  if (actionsEl && currentUser) {
    if (currentUser.uid !== uid) {
      const isFriend = friendsList.includes(uid);
      const isSent = sentRequests.includes(uid);
      const pendingReq = pendingRequests.find(req => req.uid === uid);

      let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
      if (isFriend) {
        actionBtn = `<button class="chat-btn" onclick="removeFriend('${uid}')"><i class="fa-solid fa-user-minus"></i> Unfriend</button>`;
      } else if (pendingReq) {
        actionBtn = `<button class="chat-btn" style="background: var(--color-red); color: white;" onclick="acceptFriendRequest('${uid}', '${escapeHTML(pendingReq.fromName)}')"><i class="fa-solid fa-user-check"></i> Accept Request</button>`;
      } else if (isSent) {
        actionBtn = `<button class="chat-btn" disabled style="opacity: 0.6;"><i class="fa-solid fa-clock"></i> Request Sent</button>`;
      }

      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="openChatFromTab('${uid}', '${escapeHTML(displayName)}')"><i class="fa-solid fa-comment"></i> Send Message</button>
        ${actionBtn}
      `;
    } else {
      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="document.getElementById('profileModal').classList.add('hidden'); switchTab('settings');"><i class="fa-solid fa-camera"></i> Change Custom Picture</button>
      `;
    }
  }

  modalCurrentUid = uid;
  modalPostsLimit = 5;
  renderModalUserPosts();

  if (modal) modal.classList.remove('hidden');
};

window.startCall = function(isVideo) {
  const modal = document.getElementById('callModal');
  const statusText = document.getElementById('callStatusText');
  const userNameText = document.getElementById('callUserName');
  const videoPreview = document.getElementById('callVideoPreview');
  const localVideo = document.getElementById('localVideo');
  const avatarEl = document.getElementById('callAvatar');

  if (!modal) return;
  modal.classList.remove('hidden');
  
  const recipientName = activeChatRecipientName || 'User';
  if (userNameText) userNameText.textContent = recipientName;
  if (avatarEl) avatarEl.textContent = getInitials(recipientName);

  if (statusText) statusText.textContent = isVideo ? 'Connecting Video Call...' : 'Connecting Voice Call...';

  if (isVideo && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        currentCallStream = stream;
        if (videoPreview) videoPreview.classList.remove('hidden');
        if (localVideo) localVideo.srcObject = stream;
        if (statusText) statusText.textContent = 'Call Connected';
      })
      .catch(err => {
        console.warn("Media device camera access error:", err);
        if (statusText) statusText.textContent = 'Active Call (Audio Only)';
      });
  } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        currentCallStream = stream;
        if (statusText) statusText.textContent = 'Voice Call Connected';
      })
      .catch(() => {
        if (statusText) statusText.textContent = 'Active Call';
      });
  }
};

window.endCall = function() {
  const modal = document.getElementById('callModal');
  if (currentCallStream) {
    currentCallStream.getTracks().forEach(track => track.stop());
    currentCallStream = null;
  }
  if (modal) modal.classList.add('hidden');
  const videoPreview = document.getElementById('callVideoPreview');
  if (videoPreview) videoPreview.classList.add('hidden');
  showToast('Call ended.');
};

window.sendFriendRequest = async function(targetUid) {
  if (!currentUser) return;
  try {
    await set(ref(database, `friendRequests/${targetUid}/${currentUser.uid}`), {
      fromName: currentUser.name,
      timestamp: Date.now()
    });
    await set(ref(database, `sentRequests/${currentUser.uid}/${targetUid}`), true);
    sendNotification(targetUid, currentUser.name, 'sent you a friend request.', 'fa-user-plus');
    showToast('Friend request sent!');
    if (modalCurrentUid === targetUid) window.openUserProfile(targetUid);
  } catch (err) {
    console.error("Failed to send friend request:", err);
  }
};

window.acceptFriendRequest = async function(senderUid, senderName) {
  if (!currentUser) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${senderUid}`] = true;
    updates[`friends/${senderUid}/${currentUser.uid}`] = true;
    updates[`friendRequests/${currentUser.uid}/${senderUid}`] = null;
    updates[`sentRequests/${senderUid}/${currentUser.uid}`] = null;
    
    await update(ref(database), updates);
    sendNotification(senderUid, currentUser.name, 'accepted your friend request.', 'fa-user-check');
    showToast(`You are now friends with ${senderName}`);
    if (modalCurrentUid === senderUid) window.openUserProfile(senderUid);
  } catch (err) {
    console.error("Failed to accept request:", err);
  }
};

window.removeFriend = async function(friendUid) {
  if (!currentUser || !confirm('Are you sure you want to remove this friend?')) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${friendUid}`] = null;
    updates[`friends/${friendUid}/${currentUser.uid}`] = null;
    await update(ref(database), updates);
    showToast('Friend removed.');
    if (modalCurrentUid === friendUid) window.openUserProfile(friendUid);
  } catch (err) {
    console.error("Failed to remove friend:", err);
  }
};

window.toggleLike = async function(id) {
  if (!currentUser) return;
  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);

    if (snapshot.exists()) {
      const post = snapshot.val();
      const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
      const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
      const likeSnap = await get(likeRef);

      if (likeSnap.exists()) {
        await remove(likeRef);
      } else {
        await set(likeRef, true);
        await remove(dislikeRef);
        if (post.uid && post.uid !== currentUser.uid) {
          sendNotification(post.uid, currentUser.name, 'liked your post.', 'fa-heart');
        }
      }
    }
  } catch (err) {
    console.error("Failed to toggle like:", err);
  }
};

window.toggleDislike = async function(id) {
  if (!currentUser) return;
  try {
    const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
    const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
    const snapshot = await get(dislikeRef);

    if (snapshot.exists()) {
      await remove(dislikeRef);
    } else {
      await set(dislikeRef, true);
      await remove(likeRef);
    }
  } catch (err) {
    console.error("Failed to toggle dislike:", err);
  }
};

window.toggleCommentSection = function(id) {
  const section = document.getElementById(`commentSection-${id}`);
  if (section) section.classList.toggle('hidden');
};

window.addComment = async function(id) {
  const input = document.getElementById(`commentInput-${id}`);
  if (!input || !input.value.trim()) return;

  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);

    if (snapshot.exists()) {
      const post = snapshot.val();
      const commentsRef = ref(database, `posts/${id}/comments`);
      
      await push(commentsRef, {
        author: currentUser ? currentUser.name : 'Anonymous',
        uid: currentUser ? currentUser.uid : null,
        authorAvatarUrl: currentUser ? currentUser.avatarUrl : null,
        text: input.value.trim(),
        createdAt: Date.now()
      });

      if (post.uid && currentUser && post.uid !== currentUser.uid) {
        sendNotification(post.uid, currentUser.name, 'commented on your post.', 'fa-comment');
      }
    }
    input.value = '';
  } catch (err) {
    console.error("Failed to add comment:", err);
  }
};

window.toggleEditPost = function(id) {
  const displayEl = document.getElementById(`postContent-${id}`);
  const editContainer = document.getElementById(`editPostContainer-${id}`);
  if (displayEl && editContainer) {
    displayEl.classList.toggle('hidden');
    editContainer.classList.toggle('hidden');
  }
};

window.saveEditPost = async function(id) {
  const textarea = document.getElementById(`editPostInput-${id}`);
  if (!textarea) return;
  const newContent = textarea.value.trim();
  if (!newContent) {
    showToast("Post content cannot be empty.");
    return;
  }

  try {
    await update(ref(database, `posts/${id}`), {
      content: newContent,
      editedAt: Date.now(),
      isEdited: true
    });
    showToast("Post updated successfully!");
  } catch (err) {
    console.error("Failed to update post:", err);
    showToast("Failed to save changes.");
  }
};

window.deletePost = async function(id) {
  if (!currentUser) return;
  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);
    if (snapshot.exists()) {
      const post = snapshot.val();
      if (post.uid === currentUser.uid || post.authorEmail === currentUser.email) {
        if (confirm('Are you sure you want to delete this post?')) {
          await remove(postRef);
          showToast('Post deleted successfully.');
        }
      } else {
        showToast('Unauthorized: You can only delete your own posts.');
      }
    }
  } catch (err) {
    console.error("Failed to delete post:", err);
  }
};

window.openChat = function(recipientUid, recipientName) {
  if (!currentUser) {
    showToast('Please log in to chat.');
    return;
  }

  const chatPopup = document.getElementById('chatPopup');
  const chatFriendName = document.getElementById('chatFriendName');
  const chatMessages = document.getElementById('chatMessages');
  const typingIndicator = document.getElementById('typing-indicator');

  if (!chatPopup) return;

  activeChatRecipientUid = recipientUid;
  activeChatRecipientName = recipientName || 'User';

  chatFriendName.textContent = `Chat with ${activeChatRecipientName}`;
  chatPopup.classList.remove('hidden');

  const roomPath = recipientUid ? [currentUser.uid, recipientUid].sort().join('_') : 'global_room';
  activeChatRoom = `direct_${roomPath}`;

  if (activeChatRef && activeChatCallback) {
    off(activeChatRef, 'value', activeChatCallback);
  }
  if (activeTypingListenerRef && activeTypingListenerCallback) {
    off(activeTypingListenerRef, 'value', activeTypingListenerCallback);
  }

  chatMessages.innerHTML = `<div class="chat-msg system">Connecting to conversation...</div>`;

  activeTypingListenerRef = ref(database, `typing/${activeChatRoom}`);
  activeTypingListenerCallback = (snap) => {
    if (!typingIndicator) return;
    const data = snap.val() || {};
    const isSomeoneElseTyping = Object.keys(data).some(uid => uid !== currentUser.uid && data[uid] === true);
    typingIndicator.style.display = isSomeoneElseTyping ? 'flex' : 'none';
  };
  onValue(activeTypingListenerRef, activeTypingListenerCallback);

  activeChatRef = ref(database, `chats/${activeChatRoom}`);
  activeChatCallback = (snapshot) => {
    const data = snapshot.val();
    chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(activeChatRecipientName)}</div>`;
    if (data) {
      let hasUnread = false;
      Object.entries(data).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) {
          hasUnread = true;
        }

        const msgEl = document.createElement('div');
        const isMe = msg.senderUid === currentUser.uid;
        msgEl.className = isMe ? 'chat-msg outgoing' : 'chat-msg incoming';
        
        let html = `<div>${escapeHTML(msg.text || '')}`;
        if (isMe) {
          html += ` <span class="read-receipt" data-message-id="${msgId}"><i class="fa-solid fa-check-double ${msg.read ? 'text-blue-500' : ''}"></i></span>`;
        }
        html += `</div>`;
        
        if (msg.attachment) {
          const isImg = (msg.attachmentType === 'image') || msg.attachment.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i);
          if (isImg) {
            html += `<div style="margin-top: 5px;"><img src="${escapeHTML(msg.attachment)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; display: block;" /></div>`;
          } else {
            html += `
              <div style="margin-top: 5px; background: rgba(0,0,0,0.1); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                <a href="${escapeHTML(msg.attachment)}" target="_blank" download style="color: inherit; font-weight: bold; text-decoration: underline; display: flex; align-items: center; gap: 6px;">
                  <i class="fa-solid fa-file-arrow-down"></i> ${escapeHTML(msg.attachmentName || 'Download Attachment')}
                </a>
              </div>`;
          }
        }
        msgEl.innerHTML = html;
        chatMessages.appendChild(msgEl);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (hasUnread) {
        window.markMessagesRead(activeChatRoom);
      }
    }
  };

  onValue(activeChatRef, activeChatCallback);
};

window.openChatFromTab = function(friendUid, friendName) {
  document.getElementById('profileModal')?.classList.add('hidden');
  window.openChat(friendUid, friendName);
};

window.switchTab = function(tabName) {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabViews = document.querySelectorAll('.tab-view');
  
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  tabViews.forEach(view => {
    if (view.id === `${tabName}View`) view.classList.remove('hidden');
    else view.classList.add('hidden');
  });
};

// 6. INITIALIZATION & CONTROLLERS
document.addEventListener('DOMContentLoaded', () => {

  const themeToggleBtns = document.querySelectorAll('.themeToggleBtn');
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    document.body.classList.add('dark-theme');
    themeToggleBtns.forEach(btn => btn.innerHTML = '<i class="fa-solid fa-sun"></i> Light Mode');
  }

  themeToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      themeToggleBtns.forEach(b => {
        b.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
      });
    });
  });

  let isSignUpMode = false;

  const elements = {
    authScreen: document.getElementById('authScreen'),
    appContent: document.getElementById('appContent'),
    authPageForm: document.getElementById('authPageForm'),
    tabLoginBtn: document.getElementById('tabLoginBtn'),
    tabSignupBtn: document.getElementById('tabSignupBtn'),
    fullNameGroup: document.getElementById('fullNameGroup'),
    phoneGroup: document.getElementById('phoneGroup'),
    districtGroup: document.getElementById('districtGroup'),
    villageGroup: document.getElementById('villageGroup'),
    pageAuthName: document.getElementById('pageAuthName'),
    pageAuthPhone: document.getElementById('pageAuthPhone'),
    pageAuthDistrict: document.getElementById('pageAuthDistrict'),
    pageAuthVillage: document.getElementById('pageAuthVillage'),
    pageAuthEmail: document.getElementById('pageAuthEmail'),
    pageAuthPassword: document.getElementById('pageAuthPassword'),
    pageAuthSubmitBtn: document.getElementById('pageAuthSubmitBtn'),
    authErrorMsg: document.getElementById('authErrorMsg'),
    forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),
    forgotPasswordWrapper: document.getElementById('forgotPasswordWrapper'),
    authSwitchPrompt: document.getElementById('authSwitchPrompt'),

    navDrawer: document.getElementById('navDrawer'),
    drawerOverlay: document.getElementById('drawerOverlay'),
    navBtns: document.querySelectorAll('.nav-btn'),
    drawerCloseBtn: document.getElementById('drawerCloseBtn'),
    
    profileNames: document.querySelectorAll('.profile-name'),
    profileEmails: document.querySelectorAll('.profile-email'),
    profileAvatars: document.querySelectorAll('.profile-avatar'),
    
    logoutBtns: document.querySelectorAll('.logout-btn'),
    signupBtn: document.querySelector('.signup-btn'),
    searchInput: document.getElementById('searchInput'),
    searchActionBtn: document.getElementById('searchActionBtn'),

    postText: document.getElementById('postText'),
    postPhotoInput: document.getElementById('postPhotoInput'),
    postFileInput: document.getElementById('postFileInput'),
    postBtn: document.getElementById('createPostSubmitBtn'),
    postBox: document.getElementById('postBox'),
    feedContainer: document.getElementById('feedContainer'),
    loadMorePostsBtn: document.getElementById('loadMorePostsBtn'),
    fabBtn: document.getElementById('fabBtn'),
    backToTopBtn: document.getElementById('backToTopBtn'),
    toastNotice: document.getElementById('toastNotice'),
    toastClose: document.getElementById('toastCloseBtn'),

    chatPopup: document.getElementById('chatPopup'),
    chatFriendName: document.getElementById('chatFriendName'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatFileInput: document.getElementById('chatFileInput'),
    chatSendBtn: document.getElementById('chatSendBtn'),
    chatCloseBtn: document.getElementById('chatCloseBtn'),
    
    voiceCallTrigger: document.getElementById('voiceCallTrigger'),
    videoCallTrigger: document.getElementById('videoCallTrigger'),

    tabBtns: document.querySelectorAll('.tab-btn'),
    tabViews: document.querySelectorAll('.tab-view')
  };

  function init() {
    setupPreviewContainers();
    bindEvents();
    listenToAuthState();
    listenToPosts();
    listenToUsers();
    window.switchTab('posts');
  }

  function listenToAuthState() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        let userData = {};
        try {
          const userSnapshot = await get(ref(database, `users/${user.uid}`));
          if (userSnapshot.exists()) {
            userData = userSnapshot.val();
          }
        } catch (err) {
          console.warn("Could not load user profile data from Realtime Database:", err);
        }

        currentUser = {
          uid: user.uid,
          name: userData.displayName || user.displayName || user.email.split('@')[0],
          email: user.email,
          avatarUrl: userData.avatarUrl || user.photoURL || null
        };
        
        setupPresenceSystem(user);
        updateAuthView(true);
        listenToNotifications();
        listenToUserSocialData();
      } else {
        currentUser = null;
        detachUserListeners();
        updateAuthView(false);
      }
    });
  }

  function listenToUserSocialData() {
    if (!currentUser) return;

    if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
    friendsRef = ref(database, `friends/${currentUser.uid}`);
    friendsCallback = (snap) => {
      friendsList = snap.exists() ? Object.keys(snap.val()) : [];
      renderUsersList();
    };
    onValue(friendsRef, friendsCallback);

    if (bookmarksRef && bookmarksCallback) off(bookmarksRef, 'value', bookmarksCallback);
    bookmarksRef = ref(database, `users/${currentUser.uid}/bookmarks`);
    bookmarksCallback = (snap) => {
      userBookmarks = snap.exists() ? snap.val() : {};
      renderFeed(getCurrentSearchQuery());
    };
    onValue(bookmarksRef, bookmarksCallback);

    if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
    requestsRef = ref(database, `friendRequests/${currentUser.uid}`);
    requestsCallback = (snap) => {
      pendingRequests = [];
      if (snap.exists()) {
        Object.keys(snap.val()).forEach(uid => {
          pendingRequests.push({ uid, ...snap.val()[uid] });
        });
      }
      renderUsersList();
    };
    onValue(requestsRef, requestsCallback);

    if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
    sentRequestsRef = ref(database, `sentRequests/${currentUser.uid}`);
    sentRequestsCallback = (snap) => {
      sentRequests = snap.exists() ? Object.keys(snap.val()) : [];
      renderUsersList();
    };
    onValue(sentRequestsRef, sentRequestsCallback);
  }

  function listenToUsers() {
    const usersQuery = query(ref(database, 'users'), limitToLast(100));

    onValue(usersQuery, (snapshot) => {
      const data = snapshot.val();
      usersList = [];
      if (data) {
        Object.keys(data).forEach(uid => {
          usersList.push({ uid, ...data[uid] });
        });
      }
      renderUsersList();
    });
  }

  function renderUsersList() {
    const chatsContainer = document.getElementById('chatsListContainer');
    const findFriendsContainer = document.getElementById('friendsListContainer');
    const sidebarContainer = document.getElementById('sidebarMembersContainer');

    const otherMembers = usersList.filter(u => !currentUser || u.uid !== currentUser.uid);
    const addedFriends = otherMembers.filter(u => friendsList.includes(u.uid));

    if (chatsContainer) {
      chatsContainer.innerHTML = otherMembers.length === 0 ? '<p style="color:#888; font-size:13px; padding:10px;">No members registered yet.</p>' : otherMembers.map(u => `
        <div class="friend-item" style="padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${u.uid}')">
            <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
              <div class="avatar" style="${u.avatarUrl ? `background-image: url('${u.avatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${u.avatarUrl ? '' : getInitials(u.displayName)}</div>
              <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
            </div>
            <div>
              <strong style="font-size: 14px; display: block;">${escapeHTML(u.displayName || 'Member')}</strong>
              <span style="font-size: 11px; opacity: 0.7;">${u.isOnline ? 'Online now' : 'Offline'}</span>
            </div>
          </div>
          <button class="chat-btn" onclick="openChatFromTab('${u.uid}', '${escapeHTML(u.displayName || 'Member')}')"><i class="fa-solid fa-comment"></i> Chat</button>
        </div>
      `).join('');
    }

    if (findFriendsContainer) {
      let html = '';

      if (pendingRequests.length > 0) {
        html += `<h4 style="margin: 10px 0 5px; font-size: 13px; color: var(--color-red);">Pending Requests</h4>`;
        html += pendingRequests.map(req => `
          <div class="friend-item" style="margin-bottom: 10px; padding: 8px; background: rgba(0,0,0,0.02); border-radius: 6px;">
            <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${req.uid}')">
              <div class="avatar">${getInitials(req.fromName)}</div>
              <div><strong>${escapeHTML(req.fromName)}</strong></div>
            </div>
            <button class="chat-btn" style="background: var(--color-red); color: white;" onclick="acceptFriendRequest('${req.uid}', '${escapeHTML(req.fromName)}')"><i class="fa-solid fa-user-check"></i> Accept</button>
          </div>
        `).join('');
      }

      html += `<h4 style="margin: 15px 0 5px; font-size: 13px; color: #888;">Find Friends Network</h4>`;
      html += otherMembers.length === 0 ? '<p style="color:#888; font-size:13px; padding:10px;">No other members to display.</p>' : otherMembers.map(u => {
        const isFriend = friendsList.includes(u.uid);
        const isSent = sentRequests.includes(u.uid);

        let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${u.uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
        if (isFriend) {
          actionBtn = `<button class="chat-btn" style="opacity: 0.7;" onclick="removeFriend('${u.uid}')"><i class="fa-solid fa-user-minus"></i> Remove</button>`;
        } else if (isSent) {
          actionBtn = `<button class="chat-btn" disabled style="opacity: 0.5;"><i class="fa-solid fa-clock"></i> Pending</button>`;
        }

        return `
          <div class="friend-item" style="margin-bottom: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 8px;">
            <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${u.uid}')">
              <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
                <div class="avatar" style="${u.avatarUrl ? `background-image: url('${u.avatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${u.avatarUrl ? '' : getInitials(u.displayName)}</div>
                <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
              </div>
              <div>
                <strong>${escapeHTML(u.displayName || 'Member')}</strong>
                <span style="display: block; font-size: 11px; opacity: 0.6;">${escapeHTML(u.email || 'Soroti Youth Forum')}</span>
              </div>
            </div>
            ${actionBtn}
          </div>
        `;
      }).join('');

      findFriendsContainer.innerHTML = html;
    }

    if (sidebarContainer) {
      sidebarContainer.innerHTML = addedFriends.length === 0 ? '<p style="color:#888; font-size:12px;">No added friends online yet.</p>' : addedFriends.slice(0, 5).map(u => `
        <div class="friend-item">
          <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${u.uid}')">
            <div class="avatar-wrapper ${u.isOnline ? 'online' : ''}">
              <div class="avatar" style="${u.avatarUrl ? `background-image: url('${u.avatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">${u.avatarUrl ? '' : getInitials(u.displayName)}</div>
              <div class="online-dot ${u.isOnline ? 'active' : ''}"></div>
            </div>
            <span>${escapeHTML(u.displayName || 'Member')}</span>
          </div>
          <button class="chat-btn" onclick="openChatFromTab('${u.uid}', '${escapeHTML(u.displayName || 'Member')}')"><i class="fa-solid fa-comment"></i></button>
        </div>
      `).join('');
    }
  }

  function listenToNotifications() {
    if (!currentUser) return;
    
    if (notifRef && notifCallback) off(notifRef, 'value', notifCallback);

    notifRef = ref(database, `notifications/${currentUser.uid}`);
    notifCallback = (snapshot) => {
      const data = snapshot.val();
      const notifList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          notifList.push({ id: key, ...data[key] });
        });
        notifList.sort((a, b) => b.createdAt - a.createdAt);
      }
      renderNotifications(notifList);
    };

    onValue(notifRef, notifCallback);
  }

  function renderNotifications(notifications) {
    const container = document.getElementById('notificationsContainer');
    const badgeEls = document.querySelectorAll('.notif-badge');
    
    const unreadCount = notifications.filter(n => !n.read).length;
    badgeEls.forEach(b => {
      b.textContent = unreadCount;
      b.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    });

    if (!container) return;

    if (notifications.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #888; font-size: 13px;">
          No notifications yet. You're all caught up!
        </div>`;
      return;
    }

    container.innerHTML = notifications.map(notif => `
      <div class="friend-item" style="padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05); ${notif.read ? 'opacity: 0.6;' : 'font-weight: 600;'}">
        <span>
          <i class="fa-solid ${escapeHTML(notif.icon || 'fa-bell')}" style="color: var(--color-red); margin-right: 6px;"></i> 
          <strong>${escapeHTML(notif.title)}</strong> ${escapeHTML(notif.message)}
        </span>
        <span style="font-size: 11px; opacity: 0.5;">${timeAgo(notif.createdAt)}</span>
      </div>
    `).join('');
  }

  async function markAllNotificationsRead() {
    if (!currentUser) return;
    try {
      const targetNotifRef = ref(database, `notifications/${currentUser.uid}`);
      const snapshot = await get(targetNotifRef);
      if (snapshot.exists()) {
        const updates = {};
        Object.keys(snapshot.val()).forEach(key => {
          updates[`${key}/read`] = true;
        });
        await update(targetNotifRef, updates);
        showToast('All notifications marked as read.');
      }
    } catch (err) {
      console.error("Failed to mark notifications read:", err);
    }
  }

  function listenToPosts() {
    if (elements.feedContainer) {
      elements.feedContainer.innerHTML = '<div style="text-align:center; padding:20px; color:#888;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading posts...</div>';
    }

    if (currentPostsQueryRef) {
      off(currentPostsQueryRef);
    }

    currentPostsQueryRef = query(ref(database, 'posts'), limitToLast(postsLimit));
    
    onValue(currentPostsQueryRef, (snapshot) => {
      const data = snapshot.val();
      postsList = [];
      if (data) {
        Object.keys(data).forEach((key) => {
          postsList.push({ id: key, ...data[key] });
        });
        postsList.sort((a, b) => b.createdAt - a.createdAt);
      }
      renderFeed(getCurrentSearchQuery());
      if (modalCurrentUid) {
        renderModalUserPosts();
      }
    }, (error) => {
      console.warn("Realtime database error reading posts:", error);
    });
  }

  function setupPreviewContainers() {
    if (elements.postBox) {
      const previewDiv = document.createElement('div');
      previewDiv.id = 'postPreviewContainer';
      previewDiv.style.cssText = 'margin-top: 10px; display: none; position: relative;';
      previewDiv.innerHTML = `
        <div style="position: relative; display: inline-block; max-width: 100%;">
          <img id="postPreviewImg" src="" style="max-height: 180px; max-width: 100%; border-radius: 8px; border: 1px solid #ddd; display: none;" />
          <video id="postPreviewVid" controls style="max-height: 180px; max-width: 100%; border-radius: 8px; display: none;"></video>
          <audio id="postPreviewAud" controls style="display: none; margin-top: 5px;"></audio>
          <div id="postPreviewFile" style="padding: 8px; background: rgba(0,0,0,0.05); border-radius: 6px; font-size: 12px; display: none;"></div>
          <button id="clearPostPreviewBtn" type="button" style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-size: 11px;"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
      const actionsRow = elements.postBox.querySelector('.post-actions-row');
      if (actionsRow) elements.postBox.insertBefore(previewDiv, actionsRow);

      document.getElementById('clearPostPreviewBtn')?.addEventListener('click', clearPostPreview);
    }

    if (elements.chatPopup) {
      const chatPreviewDiv = document.createElement('div');
      chatPreviewDiv.id = 'chatPreviewContainer';
      chatPreviewDiv.style.cssText = 'padding: 5px 10px; background: rgba(0,0,0,0.03); display: none; align-items: center; justify-content: space-between; font-size: 12px; border-top: 1px solid rgba(0,0,0,0.05);';
      chatPreviewDiv.innerHTML = `
        <span id="chatPreviewText" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;"></span>
        <button id="clearChatPreviewBtn" type="button" style="background: none; border: none; color: #888; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      `;
      const chatInputRow = elements.chatPopup.querySelector('.chat-input-row');
      if (chatInputRow) elements.chatPopup.insertBefore(chatPreviewDiv, chatInputRow);

      document.getElementById('clearChatPreviewBtn')?.addEventListener('click', clearChatPreview);
    }
  }

  function getCurrentSearchQuery() {
    return elements.searchInput ? elements.searchInput.value.trim() : '';
  }

  function updateAuthView(isLoggedIn) {
    if (isLoggedIn && currentUser) {
      if (elements.authScreen) elements.authScreen.style.display = 'none';
      if (elements.appContent) {
        elements.appContent.style.display = 'block';
        elements.appContent.classList.remove('hidden');
      }
      if (elements.signupBtn) elements.signupBtn.classList.add('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.remove('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.remove('hidden'));
      updateUserUI();
    } else {
      if (elements.authScreen) elements.authScreen.style.display = 'flex';
      if (elements.appContent) {
        elements.appContent.style.display = 'none';
        elements.appContent.classList.add('hidden');
      }
      if (elements.signupBtn) elements.signupBtn.classList.remove('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.add('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.add('hidden'));
    }
  }

  function setAuthMode(signUp) {
    isSignUpMode = signUp;
    if (elements.authErrorMsg) elements.authErrorMsg.textContent = '';
    
    if (isSignUpMode) {
      elements.tabSignupBtn?.classList.add('active');
      elements.tabLoginBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.remove('hidden');
      elements.phoneGroup?.classList.remove('hidden');
      elements.districtGroup?.classList.remove('hidden');
      elements.villageGroup?.classList.remove('hidden');
      elements.forgotPasswordWrapper?.classList.add('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Create Account';
      if (elements.authSwitchPrompt) {
        elements.authSwitchPrompt.innerHTML = 'Already have an account? <a href="#" id="authRedirectBtn" style="color: var(--color-red); font-weight: bold; text-decoration: underline;">Log In</a>';
      }
    } else {
      elements.tabLoginBtn?.classList.add('active');
      elements.tabSignupBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.add('hidden');
      elements.phoneGroup?.classList.add('hidden');
      elements.districtGroup?.classList.add('hidden');
      elements.villageGroup?.classList.add('hidden');
      elements.forgotPasswordWrapper?.classList.remove('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Log In';
      if (elements.authSwitchPrompt) {
        elements.authSwitchPrompt.innerHTML = 'Don\'t have an account? <a href="#" id="authRedirectBtn" style="color: var(--color-red); font-weight: bold; text-decoration: underline;">Sign Up</a>';
      }
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const isSignUp = elements.tabSignupBtn?.classList.contains('active');
    
    const email = elements.pageAuthEmail.value.trim();
    const password = elements.pageAuthPassword.value.trim();
    const name = elements.pageAuthName ? elements.pageAuthName.value.trim() : '';
    const phone = elements.pageAuthPhone ? elements.pageAuthPhone.value.trim() : '';
    const district = elements.pageAuthDistrict ? elements.pageAuthDistrict.value.trim() : '';
    const village = elements.pageAuthVillage ? elements.pageAuthVillage.value.trim() : '';

    if (!email || !password || (isSignUp && (!name || !phone || !district || !village))) {
      if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Please fill in all required fields.';
      return;
    }

    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await updateProfile(user, { displayName: name });
        try {
          await update(ref(database, `users/${user.uid}`), { 
            displayName: name, 
            email: email, 
            phone: phone,
            district: district,
            village: village,
            uid: user.uid, 
            isOnline: true 
          });
        } catch (dbErr) {
          console.warn("Database user set warning:", dbErr);
        }
        showToast(`Welcome to Soroti Youth Forum, ${name}!`);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        showToast(`Welcome back!`);
      }
      elements.pageAuthEmail.value = '';
      elements.pageAuthPassword.value = '';
      if (elements.pageAuthName) elements.pageAuthName.value = '';
      if (elements.pageAuthPhone) elements.pageAuthPhone.value = '';
      if (elements.pageAuthDistrict) elements.pageAuthDistrict.value = '';
      if (elements.pageAuthVillage) elements.pageAuthVillage.value = '';
    } catch (error) {
      if (elements.authErrorMsg) {
        if (error.code === 'auth/invalid-credential') {
          elements.authErrorMsg.textContent = 'Incorrect email or password. If you do not have an account, click Sign Up.';
        } else if (error.code === 'auth/user-not-found') {
          elements.authErrorMsg.textContent = 'No account found with this email. Click Sign Up above to register.';
        } else if (error.code === 'auth/wrong-password') {
          elements.authErrorMsg.textContent = 'Incorrect password.';
        } else {
          elements.authErrorMsg.textContent = error.message.replace('Firebase: ', '');
        }
      }
    }
  }

  async function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
      if (currentUser) {
        await set(ref(database, `users/${currentUser.uid}/isOnline`), false);
        await set(ref(database, `users/${currentUser.uid}/lastSeen`), serverTimestamp());
      }
      detachUserListeners();
      await signOut(auth);
    }
  }

  function updateUserUI() {
    if (!currentUser) return;
    elements.profileNames.forEach(el => el.textContent = currentUser.name);
    elements.profileEmails.forEach(el => el.textContent = currentUser.email);
    
    elements.profileAvatars.forEach(el => {
      applyAvatarStyle(el, currentUser.avatarUrl, currentUser.name);
    });

    const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
    if (settingsAvatarPreview) {
      applyAvatarStyle(settingsAvatarPreview, currentUser.avatarUrl, currentUser.name);
      settingsAvatarPreview.onclick = () => window.openAvatarLightbox(currentUser.avatarUrl, currentUser.name);
    }

    const nameInput = document.getElementById('settingsNameInput');
    const emailInput = document.getElementById('settingsEmailInput');
    if (nameInput) nameInput.value = currentUser.name || '';
    if (emailInput) emailInput.value = currentUser.email || '';
  }

  function renderFeed(filterQuery = '') {
    if (!elements.feedContainer) return;

    let displayPosts = postsList;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      displayPosts = postsList.filter(p => (p.content && p.content.toLowerCase().includes(q)) || (p.author && p.author.toLowerCase().includes(q)));
    }

    if (displayPosts.length === 0) {
      elements.feedContainer.innerHTML = `
        <div class="card">
          <div class="animated-stripe-bar"></div>
          <h3>No posts found</h3>
          <p style="color: #888; margin-top: 8px; font-size: 14px;">Try another search term or share an update!</p>
        </div>`;
      return;
    }

    elements.feedContainer.innerHTML = displayPosts.map(post => {
      const isOwner = currentUser && (currentUser.uid === post.uid || currentUser.email === post.authorEmail);
      const isBookmarked = userBookmarks && userBookmarks[post.id];
      
      const likesCount = post.likes ? Object.keys(post.likes).length : 0;
      const isLiked = post.likes && currentUser && post.likes[currentUser.uid];

      const dislikesCount = post.dislikes ? Object.keys(post.dislikes).length : 0;
      const isDisliked = post.dislikes && currentUser && post.dislikes[currentUser.uid];

      const commentsArray = post.comments ? Object.values(post.comments) : [];

      let attachmentHTML = '';
      if (post.attachment) {
        const type = post.attachmentType || '';
        if (type === 'image') {
          attachmentHTML = `
            <div class="media-attachment-container">
              <img src="${escapeHTML(post.attachment)}" alt="Attached Photo" style="width: 100%; max-height: 400px; object-fit: contain; display: block;" />
            </div>`;
        } else if (type === 'video') {
          attachmentHTML = `
            <div class="media-attachment-container">
              <video src="${escapeHTML(post.attachment)}" controls style="max-height: 400px; width: 100%;"></video>
            </div>`;
        } else if (type === 'audio') {
          attachmentHTML = `
            <div class="media-attachment-container" style="background: transparent;">
              <audio src="${escapeHTML(post.attachment)}" controls style="width: 100%;"></audio>
            </div>`;
        } else {
          attachmentHTML = `
            <div style="margin-bottom: 12px; font-size: 12px; opacity: 0.8; background: rgba(0,0,0,0.03); padding: 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.05);">
              <i class="fa-solid fa-paperclip"></i> Attached File: <a href="${escapeHTML(post.attachment)}" target="_blank" download style="color: inherit; font-weight: bold;">${escapeHTML(post.attachmentName || 'Download Attachment')}</a>
            </div>`;
        }
      }

      const displayTime = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');
      const authorUser = usersList.find(u => u.uid === post.uid);
      const avatarUrl = post.authorAvatarUrl || (authorUser ? authorUser.avatarUrl : null);

      return `
        <div class="card post-card" data-id="${post.id}">
          <div class="animated-stripe-bar"></div>
          
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${post.uid}')" title="View ${escapeHTML(post.author)}'s profile">
              <div class="avatar-wrapper">
                <div class="avatar" style="${avatarUrl ? `background-image: url('${avatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}">
                  ${avatarUrl ? '' : escapeHTML(post.initials || 'SY')}
                </div>
              </div>
              <div>
                <strong style="font-size: 14px; display: block;">${escapeHTML(post.author || 'Anonymous')}</strong>
                <span style="font-size: 11px; color: #888;">${escapeHTML(displayTime)} ${post.isEdited ? '<i style="font-size:10px;">(edited)</i>' : ''}</span>
              </div>
            </div>
            
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" onclick="toggleBookmark(this, '${post.id}')" title="Save Post">
                <i class="${isBookmarked ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
              </button>
              ${isOwner ? `
                <button onclick="toggleEditPost('${post.id}')" style="background: none; border: none; color: var(--text-color); opacity: 0.7; cursor: pointer; font-size: 13px;" title="Edit Post">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button onclick="deletePost('${post.id}')" style="background: none; border: none; color: #e50914; cursor: pointer; font-size: 14px;" title="Delete Post">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              ` : ''}
            </div>
          </div>
          
          ${post.content ? `<p id="postContent-${post.id}" style="font-size: 14px; line-height: 1.5; margin-bottom: 10px;">${escapeHTML(post.content)}</p>` : ''}
          
          <div id="editPostContainer-${post.id}" class="hidden" style="margin-bottom: 12px;">
            <textarea id="editPostInput-${post.id}" style="width: 100%; border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; font-size: 13px; background: var(--card-bg); color: var(--text-color); resize: vertical;">${escapeHTML(post.content || '')}</textarea>
            <div style="display: flex; gap: 8px; margin-top: 6px; justify-content: flex-end;">
              <button onclick="toggleEditPost('${post.id}')" style="padding: 4px 10px; background: transparent; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; cursor: pointer; color: var(--text-color);">Cancel</button>
              <button onclick="saveEditPost('${post.id}')" style="padding: 4px 12px; background: var(--color-red); color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer;">Save</button>
            </div>
          </div>

          ${attachmentHTML}
          
          <div style="display: flex; gap: 15px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px; font-size: 13px; align-items: center;">
            <button onclick="toggleLike('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${isLiked ? '#e50914' : 'inherit'};">
              ${isLiked ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>'} ${likesCount}
            </button>
            <button onclick="toggleDislike('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${isDisliked ? '#e50914' : 'inherit'};">
              ${isDisliked ? '<i class="fa-solid fa-thumbs-down"></i>' : '<i class="fa-regular fa-thumbs-down"></i>'} ${dislikesCount}
            </button>
            <button onclick="toggleCommentSection('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: inherit;">
              <i class="fa-solid fa-comment"></i> Comment (${commentsArray.length})
            </button>
          </div>

          <!-- COMMENTS SECTION WITH CLICKABLE PROFILE AVATARS -->
          <div id="commentSection-${post.id}" class="hidden" style="margin-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 8px;">
            <div style="max-height: 140px; overflow-y: auto; margin-bottom: 8px;">
              ${commentsArray.map(c => {
                const commenter = usersList.find(u => u.uid === c.uid);
                const cAvatarUrl = c.authorAvatarUrl || (commenter ? commenter.avatarUrl : null);
                
                return `
                  <div style="font-size: 12px; background: rgba(0,0,0,0.03); padding: 6px 8px; border-radius: 6px; margin-bottom: 5px; display: flex; align-items: flex-start; gap: 8px;">
                    <div class="avatar comment-avatar" style="${cAvatarUrl ? `background-image: url('${cAvatarUrl}'); background-size: cover; background-position: center; color: transparent;` : ''}" ${c.uid ? `onclick="openUserProfile('${c.uid}')" style="cursor:pointer;" title="View Profile"` : ''}>
                      ${cAvatarUrl ? '' : getInitials(c.author)}
                    </div>
                    <div style="flex: 1;">
                      <strong style="cursor: pointer; color: var(--text-color);" ${c.uid ? `onclick="openUserProfile('${c.uid}')"` : ''}>${escapeHTML(c.author)}:</strong> ${escapeHTML(c.text)}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
            <div style="display: flex; gap: 5px;">
              <input type="text" id="commentInput-${post.id}" placeholder="Write a comment..." style="flex:1; padding: 6px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px; outline: none; background: transparent; color: var(--text-color);" />
              <button onclick="addComment('${post.id}')" style="padding: 6px 12px; background: var(--color-black); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">Send</button>
            </div>
          </div>

        </div>
      `;
    }).join('');
  }

  async function handleCreatePost() {
    const text = elements.postText.value.trim();
    if (!text && !currentPostFile) {
      showToast("Please enter some text or select a file to post.");
      return;
    }

    if (!currentUser) {
      showToast("Please log in to share updates.");
      return;
    }

    elements.postBtn.disabled = true;
    elements.postBtn.textContent = 'Posting...';

    let mediaUrl = null;
    let attachmentType = null;

    if (currentPostFile) {
      if (currentPostFile.type.startsWith('image/')) attachmentType = 'image';
      else if (currentPostFile.type.startsWith('video/')) attachmentType = 'video';
      else if (currentPostFile.type.startsWith('audio/')) attachmentType = 'audio';
      else attachmentType = 'file';

      mediaUrl = await uploadMediaFile(currentPostFile, 'post_attachments');
    }

    try {
      const postsRef = ref(database, 'posts');
      await push(postsRef, {
        author: currentUser.name,
        authorEmail: currentUser.email,
        authorAvatarUrl: currentUser.avatarUrl || null,
        uid: currentUser.uid,
        initials: getInitials(currentUser.name),
        content: text,
        attachment: mediaUrl || null,
        attachmentType: attachmentType,
        attachmentName: currentPostFile ? currentPostFile.name : null,
        createdAt: Date.now(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      elements.postText.value = '';
      clearPostPreview();
      showToast("Post published successfully!");
    } catch (err) {
      console.error("Error pushing post to Firebase:", err);
      showToast("Failed to create post. Try again.");
    } finally {
      elements.postBtn.disabled = false;
      elements.postBtn.textContent = 'Post';
    }
  }

  async function handleSendChatMessage() {
    const text = elements.chatInput.value.trim();
    if ((!text && !currentChatFile) || !currentUser || !activeChatRoom) return;

    elements.chatInput.value = '';

    let mediaUrl = null;
    let attachmentType = null;

    if (currentChatFile) {
      attachmentType = currentChatFile.type.startsWith('image/') ? 'image' : 'file';
      mediaUrl = await uploadMediaFile(currentChatFile, 'chat_attachments');
    }

    try {
      const roomRef = ref(database, `chats/${activeChatRoom}`);
      await push(roomRef, {
        senderUid: currentUser.uid,
        senderName: currentUser.name,
        text: text,
        attachment: mediaUrl || null,
        attachmentType: attachmentType,
        attachmentName: currentChatFile ? currentChatFile.name : null,
        read: false,
        timestamp: Date.now()
      });

      const typingRef = ref(database, `typing/${activeChatRoom}/${currentUser.uid}`);
      set(typingRef, false);

      clearChatPreview();
    } catch (err) {
      console.error("Failed to send chat message:", err);
      showToast("Message failed to send.");
    }
  }

  function handleFileSelect(e, isChat = false) {
    const file = e.target.files[0];
    if (!file) return;

    if (isChat) {
      currentChatFile = file;
      const chatPreviewDiv = document.getElementById('chatPreviewContainer');
      const chatPreviewText = document.getElementById('chatPreviewText');
      if (chatPreviewDiv && chatPreviewText) {
        chatPreviewText.textContent = `Attached: ${file.name}`;
        chatPreviewDiv.style.display = 'flex';
      }
    } else {
      currentPostFile = file;
      const previewDiv = document.getElementById('postPreviewContainer');
      const img = document.getElementById('postPreviewImg');
      const vid = document.getElementById('postPreviewVid');
      const aud = document.getElementById('postPreviewAud');
      const doc = document.getElementById('postPreviewFile');

      if (!previewDiv) return;
      previewDiv.style.display = 'block';
      img.style.display = 'none';
      vid.style.display = 'none';
      aud.style.display = 'none';
      doc.style.display = 'none';

      const fileUrl = URL.createObjectURL(file);
      if (file.type.startsWith('image/')) {
        img.src = fileUrl; img.style.display = 'block';
      } else if (file.type.startsWith('video/')) {
        vid.src = fileUrl; vid.style.display = 'block';
      } else if (file.type.startsWith('audio/')) {
        aud.src = fileUrl; aud.style.display = 'block';
      } else {
        doc.textContent = `Attached File: ${file.name}`; doc.style.display = 'block';
      }
    }
  }

  function clearPostPreview() {
    currentPostFile = null;
    if (elements.postPhotoInput) elements.postPhotoInput.value = '';
    if (elements.postFileInput) elements.postFileInput.value = '';
    const previewDiv = document.getElementById('postPreviewContainer');
    if (previewDiv) previewDiv.style.display = 'none';
  }

  function clearChatPreview() {
    currentChatFile = null;
    if (elements.chatFileInput) elements.chatFileInput.value = '';
    const chatPreviewDiv = document.getElementById('chatPreviewContainer');
    if (chatPreviewDiv) chatPreviewDiv.style.display = 'none';
  }

  function bindEvents() {
    // Input Focus Tracking
    document.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        lastFocusedInput = e.target;
      }
    });

    // Close Emoji Picker Dropdown on click outside
    document.addEventListener('click', (e) => {
      const emojiPicker = document.getElementById('emoji-picker-dropdown');
      const isEmojiBtn = e.target.closest('.emoji-trigger-btn');
      if (emojiPicker && !emojiPicker.contains(e.target) && !isEmojiBtn) {
        emojiPicker.classList.add('hidden');
      }
    });

    // Navigation Drawer Controls
    elements.navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        elements.navDrawer?.classList.add('open');
        elements.drawerOverlay?.classList.add('active');
      });
    });

    elements.drawerCloseBtn?.addEventListener('click', closeDrawer);
    elements.drawerOverlay?.addEventListener('click', closeDrawer);

    // Profile Click Listeners (Top bar & Nav Drawer user info)
    const topBarUserProfile = document.getElementById('topBarUserProfile');
    const drawerProfileInfo = document.getElementById('drawerProfileInfo');
    
    topBarUserProfile?.addEventListener('click', () => {
      if (currentUser) window.openUserProfile(currentUser.uid);
    });

    drawerProfileInfo?.addEventListener('click', () => {
      closeDrawer();
      if (currentUser) window.openUserProfile(currentUser.uid);
    });

    // Close Modals
    document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => {
      document.getElementById('profileModal')?.classList.add('hidden');
    });

    document.getElementById('closeLightboxModalBtn')?.addEventListener('click', () => {
      document.getElementById('avatarLightboxModal')?.classList.add('hidden');
    });

    document.getElementById('avatarLightboxModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'avatarLightboxModal') {
        document.getElementById('avatarLightboxModal')?.classList.add('hidden');
      }
    });

    // Auth Mode Toggles
    elements.tabLoginBtn?.addEventListener('click', () => setAuthMode(false));
    elements.tabSignupBtn?.addEventListener('click', () => setAuthMode(true));
    
    // Auth Redirect Link Delegate
    elements.authSwitchPrompt?.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'authRedirectBtn') {
        e.preventDefault();
        setAuthMode(!isSignUpMode);
      }
    });

    elements.authPageForm?.addEventListener('submit', handleAuthSubmit);

    // Password Reset Listener
    elements.forgotPasswordBtn?.addEventListener('click', async () => {
      const email = elements.pageAuthEmail.value.trim();
      if (!email) {
        if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Please enter your email address to reset password.';
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset email sent! Check your inbox.');
      } catch (err) {
        if (elements.authErrorMsg) elements.authErrorMsg.textContent = err.message.replace('Firebase: ', '');
      }
    });

    elements.logoutBtns.forEach(btn => btn.addEventListener('click', handleLogout));

    // Profile Picture Upload Listener inside Settings
    const profilePicInput = document.getElementById('profilePicInput');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    profilePicInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !currentUser) return;
      
      showToast("Uploading new profile picture...");
      const uploadedUrl = await uploadMediaFile(file, 'profile_pictures');
      
      if (uploadedUrl) {
        currentUser.avatarUrl = uploadedUrl;
        await update(ref(database, `users/${currentUser.uid}`), { avatarUrl: uploadedUrl });
        updateUserUI();
        showToast("Profile picture updated!");
      }
    });

    saveSettingsBtn?.addEventListener('click', async () => {
      const nameInput = document.getElementById('settingsNameInput');
      if (!nameInput || !currentUser) return;
      
      const newName = nameInput.value.trim();
      if (newName && newName !== currentUser.name) {
        currentUser.name = newName;
        await updateProfile(auth.currentUser, { displayName: newName });
        await update(ref(database, `users/${currentUser.uid}`), { displayName: newName });
        updateUserUI();
        showToast("Profile settings saved!");
      } else {
        showToast("Settings updated.");
      }
    });

    // Post creation events
    elements.postBtn?.addEventListener('click', handleCreatePost);
    elements.postPhotoInput?.addEventListener('change', (e) => handleFileSelect(e, false));
    elements.postFileInput?.addEventListener('change', (e) => handleFileSelect(e, false));

    // Search action listeners
    elements.searchActionBtn?.addEventListener('click', () => renderFeed(getCurrentSearchQuery()));
    elements.searchInput?.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') renderFeed(getCurrentSearchQuery());
    });

    // Chat events
    elements.chatSendBtn?.addEventListener('click', handleSendChatMessage);
    elements.chatInput?.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') handleSendChatMessage();
      else window.triggerTypingStatus();
    });
    elements.chatFileInput?.addEventListener('change', (e) => handleFileSelect(e, true));
    elements.chatCloseBtn?.addEventListener('click', () => elements.chatPopup?.classList.add('hidden'));

    // Call triggers
    elements.voiceCallTrigger?.addEventListener('click', () => window.startCall(false));
    elements.videoCallTrigger?.addEventListener('click', () => window.startCall(true));
    document.getElementById('callEndBtn')?.addEventListener('click', window.endCall);

    // Toast Close
    elements.toastClose?.addEventListener('click', () => {
      if (elements.toastNotice) elements.toastNotice.style.display = 'none';
    });

    // Tab items switching
    elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => window.switchTab(btn.dataset.tab));
    });

    document.querySelectorAll('.nav-link-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        closeDrawer();
        window.switchTab(link.dataset.tab);
      });
    });

    // FAB and Back to top button
    elements.fabBtn?.addEventListener('click', () => {
      window.switchTab('posts');
      elements.postText?.focus();
    });

    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) elements.backToTopBtn?.classList.remove('hidden');
      else elements.backToTopBtn?.classList.add('hidden');
    });

    elements.backToTopBtn?.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Infinite modal post loader on scroll
    const modalPostsContainer = document.getElementById('modalUserPostsContainer');
    modalPostsContainer?.addEventListener('scroll', () => {
      if (modalPostsContainer.scrollTop + modalPostsContainer.clientHeight >= modalPostsContainer.scrollHeight - 20) {
        modalPostsLimit += 5;
        renderModalUserPosts();
      }
    });

    // Load more feed posts button
    elements.loadMorePostsBtn?.addEventListener('click', () => {
      postsLimit += 15;
      listenToPosts();
    });

    document.getElementById('markAllReadBtn')?.addEventListener('click', markAllNotificationsRead);
  }

  init();
});